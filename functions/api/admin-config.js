import { ACTIVITY_CONTENT_PREFIX, json, parseActivityContents, readBody, supabase } from "../_shared.js";
import { merchantAccessCode } from "../_merchant-session.js";
import { parseReceiptNote, signedReceiptUrl } from "../_receipt.js";

function assertAdmin(env, password) {
  if (!env.ADMIN_PASSWORD || password !== env.ADMIN_PASSWORD) {
    const err = new Error("后台密码错误。");
    err.statusCode = 401;
    throw err;
  }
}

function stringifyActivityContents(merchants) {
  const entries = {};
  merchants.forEach((merchant) => {
    const content = String(merchant.activity_content || "").trim();
    if (merchant.id && content) entries[merchant.id] = content;
  });
  return ACTIVITY_CONTENT_PREFIX + JSON.stringify(entries);
}

function mergeActivityContents(merchants, setting) {
  const saved = parseActivityContents(setting);
  return merchants.map((merchant) => ({
    ...merchant,
    activity_content: saved[merchant.id] || merchant.activity_content || ""
  }));
}

function statusOf(coupon) {
  if (coupon.status === "used") return "used";
  if (coupon.status === "expired") return "expired";
  return new Date().toISOString().slice(0, 10) > coupon.end_date ? "expired" : "unused";
}

async function loadConfig(env) {
  const [settings, merchants, couponTypes, thresholdRules, coupons] = await Promise.all([
    supabase(env, "activity_settings?select=*&id=eq.main"),
    supabase(env, "merchants?select=*&order=sort_order.asc,name.asc"),
    supabase(env, "coupon_types?select=*&order=sort_order.asc"),
    supabase(env, "threshold_rules?select=*&order=sort_order.asc"),
    supabase(env, "coupons?select=*&order=issued_at.desc")
  ]);
  const setting = settings[0];
  const merchantsWithContent = mergeActivityContents(merchants, setting);
  return {
    setting,
    merchants: await Promise.all(merchantsWithContent.map(async (merchant) => ({
      ...merchant,
      access_code: await merchantAccessCode(env, merchant)
    }))),
    couponTypes,
    thresholdRules,
    coupons: coupons.map((coupon) => {
      const receiptNote = parseReceiptNote(coupon.note);
      return {
        ...coupon,
        note_text: receiptNote.issueReceipt || receiptNote.redeemReceipt ? "" : coupon.note,
        issue_receipt_path: receiptNote.issueReceipt?.path || "",
        redeem_receipt_path: receiptNote.redeemReceipt?.path || "",
        computedStatus: statusOf(coupon)
      };
    })
  };
}

async function upsert(env, table, rows) {
  if (!rows.length) return [];
  return supabase(env, `${table}?on_conflict=id`, {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify(rows)
  });
}

function withoutActivityContent(rows) {
  return rows.map(({ activity_content, access_code, ...row }) => row);
}

function isMissingActivityContentColumn(err) {
  const message = String(err.message || "");
  return message.includes("activity_content") && message.includes("PGRST204");
}

async function saveConfig(env, body) {
  const { setting, merchants = [], couponTypes = [], thresholdRules = [] } = body;
  await supabase(env, "activity_settings?id=eq.main", {
    method: "PATCH",
    body: JSON.stringify({
      activity_name: setting.activity_name,
      benefit_text: setting.benefit_text,
      default_valid_days: Number(setting.default_valid_days || 0),
      starts_on: setting.starts_on || null,
      ends_on: setting.ends_on || null,
      admin_password_hash: stringifyActivityContents(merchants),
      updated_at: new Date().toISOString()
    })
  });
  const merchantRows = merchants.map(({ access_code, ...merchant }, idx) => ({
    ...merchant,
    activity_content: merchant.activity_content || "",
    sort_order: Number(merchant.sort_order ?? idx),
    active: Boolean(merchant.active),
    can_issue: Boolean(merchant.can_issue),
    can_redeem: Boolean(merchant.can_redeem),
    is_guide_point: Boolean(merchant.is_guide_point),
    updated_at: new Date().toISOString()
  }));
  try {
    await upsert(env, "merchants", merchantRows);
  } catch (err) {
    if (!isMissingActivityContentColumn(err)) throw err;
    await upsert(env, "merchants", withoutActivityContent(merchantRows));
  }
  await upsert(env, "coupon_types", couponTypes.map((type, idx) => ({
    ...type, sort_order: Number(type.sort_order ?? idx), active: Boolean(type.active), updated_at: new Date().toISOString()
  })));
  await upsert(env, "threshold_rules", thresholdRules.map((rule, idx) => ({
    ...rule, min_amount: Number(rule.min_amount || 0), sort_order: Number(rule.sort_order ?? idx), active: Boolean(rule.active), updated_at: new Date().toISOString()
  })));
}

async function deleteCoupons(env, path) {
  return supabase(env, path, { method: "DELETE" });
}

async function clearTestCoupons(env) {
  const legacyCodes = ["REP-0708-261876", "GUI-0708-138044"];
  const autoRows = await deleteCoupons(env, "coupons?note=like.AUTO_LOAD_TEST*");
  const legacyRows = await deleteCoupons(env, `coupons?code=in.(${legacyCodes.join(",")})`);
  return { deleted: (autoRows?.length || 0) + (legacyRows?.length || 0) };
}

async function clearAllCoupons(env) {
  const rows = await deleteCoupons(env, "coupons?id=not.is.null");
  return { deleted: rows?.length || 0 };
}

async function voidCoupon(env, code) {
  const normalized = String(code || "").trim().toUpperCase();
  if (!normalized) throw Object.assign(new Error("缺少券码，无法作废。"), { statusCode: 400 });
  const rows = await supabase(env, `coupons?code=eq.${encodeURIComponent(normalized)}&status=neq.used`, {
    method: "PATCH",
    body: JSON.stringify({ status: "expired", end_date: new Date(Date.now() - 86400000).toISOString().slice(0, 10), note: "后台手动作废" })
  });
  return { updated: rows?.length || 0 };
}

async function deleteMerchant(env, id) {
  const normalized = String(id || "").trim();
  if (!normalized) throw Object.assign(new Error("缺少商户 ID，无法删除。"), { statusCode: 400 });
  const rows = await supabase(env, `merchants?id=eq.${encodeURIComponent(normalized)}`, { method: "DELETE" });
  return { deleted: rows?.length || 0 };
}

export async function onRequestPost({ request, env }) {
  try {
    const body = await readBody(request);
    assertAdmin(env, body.password);
    if (body.action === "save") {
      await saveConfig(env, body.data || {});
      return json({ ok: true });
    }
    if (body.action === "clearTestCoupons") return json({ ok: true, data: await clearTestCoupons(env) });
    if (body.action === "clearAllCoupons") return json({ ok: true, data: await clearAllCoupons(env) });
    if (body.action === "voidCoupon") return json({ ok: true, data: await voidCoupon(env, body.code || body.data?.code) });
    if (body.action === "deleteMerchant") return json({ ok: true, data: await deleteMerchant(env, body.id || body.data?.id) });
    if (body.action === "receiptUrl") {
      return json({ ok: true, data: { url: await signedReceiptUrl(env, body.data?.path) } });
    }
    return json({ ok: true, data: await loadConfig(env) });
  } catch (err) {
    return json({ ok: false, message: err.message || "后台请求失败。" }, err.statusCode || 400);
  }
}
