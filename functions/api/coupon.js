import { json, parseActivityContents, readBody, supabase } from "../_shared.js";
import { bearerToken, verifyMerchantToken } from "../_merchant-session.js";
import { assertUniqueReceipt, deleteReceipt, deleteReceiptFingerprint, identifyReceipt, parseReceiptNote, registerReceiptFingerprint, storeReceipt } from "../_receipt.js";

function shanghaiDate() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function statusOf(coupon) {
  if (coupon.status === "used") return "used";
  if (coupon.status === "expired" || shanghaiDate() > coupon.end_date) return "expired";
  return "unused";
}

function publicCoupon(coupon) {
  return {
    code: coupon.code,
    coupon_type_code: coupon.coupon_type_code,
    coupon_type_name: coupon.coupon_type_name,
    source_label: coupon.source_label,
    benefit_text: coupon.benefit_text,
    start_date: coupon.start_date,
    end_date: coupon.end_date,
    computedStatus: statusOf(coupon)
  };
}

function proofType(value) {
  return value === "paper" ? "paper" : "screen";
}

async function loadCoupon(env, code) {
  const normalized = String(code || "").trim().toUpperCase();
  if (!normalized) throw new Error("请扫码或输入券码。");
  const rows = await supabase(env, `coupons?select=*&code=eq.${encodeURIComponent(normalized)}&limit=1`);
  if (!rows[0]) throw new Error("未找到该券码。");
  return rows[0];
}

async function merchantFromRequest(env, request) {
  const session = await verifyMerchantToken(env, bearerToken(request));
  const rows = await supabase(env, `merchants?select=*&id=eq.${encodeURIComponent(session.merchantId)}&active=eq.true&limit=1`);
  if (!rows[0]) throw new Error("商户账号已停用，请联系管理人员。");
  return rows[0];
}

async function activitySetting(env) {
  const rows = await supabase(env, "activity_settings?select=*&id=eq.main&limit=1");
  const setting = rows[0];
  if (!setting) throw new Error("活动基础配置缺失。");
  const today = shanghaiDate();
  if ((setting.starts_on && today < setting.starts_on) || (setting.ends_on && today > setting.ends_on)) {
    throw new Error("当前不在活动有效期内，已停止发券和核销。");
  }
  return setting;
}

async function issue(env, request, body) {
  const merchant = await merchantFromRequest(env, request);
  if (!merchant.can_issue) throw new Error("当前商户未开通发券权限。");
  if (body.receiptConsent !== true) throw new Error("请先向顾客说明小票信息用途并取得同意。");
  await activitySetting(env);
  let receipt;
  try {
    receipt = await assertUniqueReceipt(env, body.receipt);
  } catch (err) {
    if (err.exactReceiptMatch && err.existingCouponCode) {
      const existing = await loadCoupon(env, err.existingCouponCode).catch(() => null);
      const issuedRecently = existing?.issued_at && Date.now() - new Date(existing.issued_at).getTime() < 5 * 60 * 1000;
      if (existing?.source_merchant_id === merchant.id && statusOf(existing) === "unused" && issuedRecently) {
        return { ok: true, coupon: publicCoupon(existing), reusedAfterRetry: true };
      }
    }
    throw err;
  }
  const thresholdRows = await supabase(env, `threshold_rules?select=*&category_key=eq.${encodeURIComponent(merchant.category_key)}&active=eq.true&limit=1`);
  const threshold = thresholdRows[0];
  if (!threshold) throw new Error("当前商户的消费类别未配置赠券门槛。");
  const result = await supabase(env, "rpc/public_issue_coupon", {
    method: "POST",
    body: JSON.stringify({
      p_coupon_type_code: body.couponTypeCode,
      p_source_merchant_id: merchant.id,
      p_category_key: merchant.category_key,
      p_order_amount: Number(threshold.min_amount)
    })
  });
  if (!result?.ok || !result.coupon?.code) throw new Error(result?.message || "发券失败。");
  let savedReceipt;
  try {
    savedReceipt = await storeReceipt(env, receipt, merchant, "issue", result.coupon.code);
    savedReceipt.proofType = proofType(body.proofType);
    await registerReceiptFingerprint(env, receipt, savedReceipt, result.coupon.code, "issue", merchant.id);
    await supabase(env, `coupons?code=eq.${encodeURIComponent(result.coupon.code)}`, {
      method: "PATCH",
      body: JSON.stringify({ note: JSON.stringify({ issueReceipt: savedReceipt, receiptConsentAt: new Date().toISOString() }), issued_amount: 0 })
    });
  } catch (err) {
    if (savedReceipt?.path) await deleteReceiptFingerprint(env, savedReceipt.path).catch(() => {});
    if (savedReceipt?.path) await deleteReceipt(env, savedReceipt.path).catch(() => {});
    await supabase(env, `coupons?code=eq.${encodeURIComponent(result.coupon.code)}`, { method: "DELETE" }).catch(() => {});
    throw err;
  }
  return { ...result, coupon: publicCoupon({ ...result.coupon, note: "", issued_amount: 0 }) };
}

async function check(env, request, body) {
  await merchantFromRequest(env, request);
  return { ok: true, coupon: publicCoupon(await loadCoupon(env, body.code)) };
}

async function redeem(env, request, body) {
  const merchant = await merchantFromRequest(env, request);
  if (!merchant.can_redeem) throw new Error("当前商户未开通核销权限。");
  await activitySetting(env);
  const coupon = await loadCoupon(env, body.code);
  const receipt = await identifyReceipt(body.receipt);
  if (coupon.status === "used") {
    const existingNote = parseReceiptNote(coupon.note);
    if (existingNote.redeemReceipt?.contentHash === receipt.contentHash && coupon.redeem_merchant_id === merchant.id) {
      return { ok: true, coupon: publicCoupon(coupon), reusedAfterRetry: true };
    }
    throw new Error("该券已使用，不能重复核销。");
  }
  if (statusOf(coupon) !== "unused") throw new Error("该券已过期，不能核销。");
  let savedReceipt;
  let createdReceiptNow = false;
  try {
    await assertUniqueReceipt(env, null, receipt);
    savedReceipt = await storeReceipt(env, receipt, merchant, "redeem", coupon.code);
    savedReceipt.proofType = proofType(body.proofType);
    await registerReceiptFingerprint(env, receipt, savedReceipt, coupon.code, "redeem", merchant.id).catch(async (err) => {
      await deleteReceipt(env, savedReceipt.path).catch(() => {});
      throw err;
    });
    createdReceiptNow = true;
  } catch (err) {
    if (!err.exactReceiptMatch) throw err;
    const fingerprints = await supabase(env, `receipt_fingerprints?select=*&content_hash=eq.${receipt.contentHash}&coupon_code=eq.${encodeURIComponent(coupon.code)}&receipt_kind=eq.redeem&merchant_id=eq.${encodeURIComponent(merchant.id)}&limit=1`);
    const fingerprint = fingerprints[0];
    if (!fingerprint) throw err;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const current = await loadCoupon(env, coupon.code);
      const currentNote = parseReceiptNote(current.note);
      if (current.status === "used" && currentNote.redeemReceipt?.contentHash === receipt.contentHash) {
        return { ok: true, coupon: publicCoupon(current), reusedAfterRetry: true };
      }
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 500));
    }
    savedReceipt = {
      path: fingerprint.storage_path,
      contentHash: fingerprint.content_hash,
      perceptualHash: fingerprint.perceptual_hash,
      merchantId: merchant.id,
      merchantLabel: `${merchant.shop_code}｜${merchant.name}`,
      capturedAt: fingerprint.created_at,
      proofType: proofType(body.proofType)
    };
  }
  const note = parseReceiptNote(coupon.note);
  let result;
  try {
    result = await supabase(env, "rpc/public_redeem_coupon", {
      method: "POST",
      body: JSON.stringify({
        p_code: coupon.code,
        p_redeem_merchant_id: merchant.id,
        p_redeem_amount: 0,
        p_phone_last4: "",
        p_note: JSON.stringify({ ...note, redeemReceipt: savedReceipt })
      })
    });
  } catch (err) {
    const refreshed = await loadCoupon(env, coupon.code).catch(() => null);
    const refreshedNote = parseReceiptNote(refreshed?.note);
    if (refreshed?.status === "used" && refreshedNote.redeemReceipt?.path === savedReceipt.path) {
      return { ok: true, coupon: publicCoupon(refreshed), recoveredAfterNetworkError: true };
    }
    if (createdReceiptNow) {
      await deleteReceiptFingerprint(env, savedReceipt.path).catch(() => {});
      await deleteReceipt(env, savedReceipt.path).catch(() => {});
    }
    throw err;
  }
  if (!result?.ok) {
    const refreshed = await loadCoupon(env, coupon.code).catch(() => null);
    const refreshedNote = parseReceiptNote(refreshed?.note);
    if (refreshed?.status === "used" && refreshedNote.redeemReceipt?.contentHash === receipt.contentHash) {
      return { ok: true, coupon: publicCoupon(refreshed), reusedAfterRetry: true };
    }
    if (createdReceiptNow) {
      await deleteReceiptFingerprint(env, savedReceipt.path).catch(() => {});
      await deleteReceipt(env, savedReceipt.path).catch(() => {});
    }
    throw new Error(result?.message || "核销失败。");
  }
  return { ...result, coupon: publicCoupon(result.coupon) };
}

export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);
    return json({ ok: true, coupon: publicCoupon(await loadCoupon(env, url.searchParams.get("code"))) }, 200, "no-store");
  } catch (err) {
    return json({ ok: false, message: err.message || "查询券码失败。" }, 400);
  }
}

export async function onRequestPost({ request, env }) {
  try {
    const body = await readBody(request);
    if (body.action === "issue") return json(await issue(env, request, body), 200, "no-store");
    if (body.action === "check") return json(await check(env, request, body), 200, "no-store");
    if (body.action === "redeem") return json(await redeem(env, request, body), 200, "no-store");
    throw new Error("不支持的券操作。");
  } catch (err) {
    const status = /登录|口令|账号/.test(err.message || "") ? 401 : 400;
    return json({ ok: false, message: err.message || "券操作失败。" }, status);
  }
}
