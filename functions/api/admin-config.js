import { ACTIVITY_CONTENT_PREFIX, assertAuthAllowed, json, parseActivityContents, readBody, recordAuthFailure, supabase, supabaseWithMeta } from "../_shared.js";
import { merchantAccessCode } from "../_merchant-session.js";
import { deleteReceipts, parseReceiptNote, signedReceiptUrl } from "../_receipt.js";

const encoder = new TextEncoder();

async function assertAdmin(env, request, password) {
  if (!env.ADMIN_PASSWORD || password !== env.ADMIN_PASSWORD) {
    const throttleKey = await assertAuthAllowed(env, request, "admin");
    await recordAuthFailure(env, throttleKey);
    await new Promise((resolve) => setTimeout(resolve, 650));
    const err = new Error("后台密码错误。");
    err.statusCode = 401;
    throw err;
  }
}

function stringifyActivityContents(merchants) {
  const entries = {};
  merchants.forEach((merchant) => {
    const content = String(merchant.activity_content || "").trim();
    if (merchant.id) entries[merchant.id] = content;
  });
  return ACTIVITY_CONTENT_PREFIX + JSON.stringify(entries);
}

function mergeActivityContents(merchants, setting) {
  const saved = parseActivityContents(setting);
  return merchants.map((merchant) => ({
    ...merchant,
    activity_content: Object.prototype.hasOwnProperty.call(saved, merchant.id)
      ? String(saved[merchant.id] || "")
      : merchant.activity_content || ""
  }));
}

function shanghaiDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit"
  }).format(new Date());
}

function statusOf(coupon) {
  if (coupon.status === "used") return "used";
  if (coupon.status === "expired" || shanghaiDate() > coupon.end_date) return "expired";
  return "unused";
}

function presentCoupon(coupon) {
  const receiptNote = parseReceiptNote(coupon.note);
  return {
    ...coupon,
    note_text: receiptNote.issueReceipt || receiptNote.redeemReceipt ? "" : coupon.note,
    issue_receipt_path: receiptNote.issueReceipt?.path || "",
    redeem_receipt_path: receiptNote.redeemReceipt?.path || "",
    issue_proof_type: receiptNote.issueReceipt?.proofType || "",
    redeem_proof_type: receiptNote.redeemReceipt?.proofType || "",
    computedStatus: statusOf(coupon)
  };
}

function normalizeFilters(raw = {}) {
  const pageSize = Math.min(100, Math.max(10, Number(raw.pageSize) || 30));
  return {
    page: Math.max(1, Number(raw.page) || 1),
    pageSize,
    keyword: String(raw.keyword || "").trim().slice(0, 80),
    status: ["unused", "used", "expired"].includes(raw.status) ? raw.status : "all",
    type: String(raw.type || "all").trim(),
    from: /^\d{4}-\d{2}-\d{2}$/.test(raw.from || "") ? raw.from : "",
    to: /^\d{4}-\d{2}-\d{2}$/.test(raw.to || "") ? raw.to : ""
  };
}

function nextDate(dateText) {
  const date = new Date(`${dateText}T00:00:00+08:00`);
  date.setUTCDate(date.getUTCDate() + 1);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit"
  }).format(date);
}

function couponQuery(filters, { redeemedOnly = false, paging = true } = {}) {
  const parts = ["select=*", "order=issued_at.desc"];
  if (filters.keyword) {
    const value = encodeURIComponent(`*${filters.keyword.replace(/[,*()]/g, " ")}*`);
    parts.push(`or=(code.ilike.${value},source_label.ilike.${value},redeem_point_label.ilike.${value},coupon_type_name.ilike.${value})`);
  }
  if (filters.type !== "all") parts.push(`coupon_type_code=eq.${encodeURIComponent(filters.type)}`);
  if (filters.from) parts.push(`issued_at=gte.${encodeURIComponent(`${filters.from}T00:00:00+08:00`)}`);
  if (filters.to) parts.push(`issued_at=lt.${encodeURIComponent(`${nextDate(filters.to)}T00:00:00+08:00`)}`);
  if (redeemedOnly || filters.status === "used") parts.push("status=eq.used");
  if (!redeemedOnly && filters.status === "unused") parts.push(`status=eq.unused&end_date=gte.${shanghaiDate()}`);
  if (!redeemedOnly && filters.status === "expired") parts.push(`or=(status.eq.expired,and(status.eq.unused,end_date.lt.${shanghaiDate()}))`);
  if (paging) {
    parts.push(`limit=${filters.pageSize}`);
    parts.push(`offset=${(filters.page - 1) * filters.pageSize}`);
  }
  return `coupons?${parts.join("&")}`;
}

async function rowsWithCount(env, query) {
  const result = await supabaseWithMeta(env, query, { headers: { Prefer: "count=exact" } });
  return { rows: result.data || [], count: result.count };
}

async function countRows(env, filter = "") {
  const result = await supabaseWithMeta(env, `coupons?select=id${filter ? `&${filter}` : ""}&limit=1`, {
    headers: { Prefer: "count=exact" }
  });
  return result.count;
}

async function loadMetrics(env) {
  return supabase(env, "rpc/admin_coupon_metrics", { method: "POST", body: "{}" });
}

async function loadConfig(env, rawFilters) {
  const filters = normalizeFilters(rawFilters);
  const [settings, merchants, couponTypes, thresholdRules] = await Promise.all([
    supabase(env, "activity_settings?select=*&id=eq.main"),
    supabase(env, "merchants?select=*&order=sort_order.asc,name.asc"),
    supabase(env, "coupon_types?select=*&order=sort_order.asc"),
    supabase(env, "threshold_rules?select=*&order=sort_order.asc")
  ]);
  const [issued, redeemed, metrics, archiveBatches, auditLogs] = await Promise.all([
    rowsWithCount(env, couponQuery(filters)).catch(() => ({ rows: [], count: 0 })),
    rowsWithCount(env, couponQuery(filters, { redeemedOnly: true })).catch(() => ({ rows: [], count: 0 })),
    loadMetrics(env).catch(() => []),
    supabase(env, "coupon_archive_batches?select=id,action,coupon_count,receipt_count,created_at,restored_at,note&order=created_at.desc&limit=10").catch(() => []),
    supabase(env, "admin_audit_logs?select=action,target,detail,created_at&action=neq.auth_failure&order=created_at.desc&limit=50").catch(() => [])
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
    coupons: issued.rows.map(presentCoupon),
    redeemedCoupons: redeemed.rows.map(presentCoupon),
    pagination: { page: filters.page, pageSize: filters.pageSize, issuedTotal: issued.count, redeemedTotal: redeemed.count },
    metrics,
    archiveBatches,
    auditLogs
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

async function audit(env, action, target = "", detail = {}) {
  await supabase(env, "admin_audit_logs", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ action, target, detail })
  });
}

function merchantNameFromLabel(value) {
  const parts = String(value || "").split(/\s*[|｜]\s*/).filter(Boolean);
  return (parts.length > 1 ? parts.at(-1) : parts[0] || "").trim();
}

function merchantNamesFromCoupons(rows) {
  return [...new Set(rows.map((row) => merchantNameFromLabel(row.source_label)).filter(Boolean))];
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
  await audit(env, "save_config", "activity", {
    merchants: merchants.length,
    couponTypes: couponTypes.length,
    thresholdRules: thresholdRules.length,
    merchantNames: merchants.map((merchant) => merchant.name).filter(Boolean)
  });
}

function receiptPaths(rows) {
  const paths = [];
  rows.forEach((row) => {
    const note = parseReceiptNote(row.note);
    if (note.issueReceipt?.path) paths.push(note.issueReceipt.path);
    if (note.redeemReceipt?.path) paths.push(note.redeemReceipt.path);
  });
  return [...new Set(paths)];
}

async function archiveCoupons(env, rows, action, note = "") {
  if (!rows.length) return null;
  const batchRows = await supabase(env, "coupon_archive_batches", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ action, coupon_count: rows.length, receipt_count: receiptPaths(rows).length, note })
  });
  const batch = batchRows[0];
  for (let index = 0; index < rows.length; index += 100) {
    await supabase(env, "coupon_archives", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(rows.slice(index, index + 100).map((row) => ({
        batch_id: batch.id,
        coupon_code: row.code,
        coupon_data: row
      })))
    });
  }
  return batch;
}

async function deleteCouponRows(env, rows, action, { archive = false } = {}) {
  if (!rows.length) return { deleted: 0, deletedFiles: 0, batchId: null };
  const codes = rows.map((row) => row.code);
  const fingerprintPaths = [];
  for (let index = 0; index < codes.length; index += 100) {
    const filter = `in.(${codes.slice(index, index + 100).map(encodeURIComponent).join(",")})`;
    const fingerprints = await supabase(env, `receipt_fingerprints?select=storage_path&coupon_code=${filter}`);
    fingerprintPaths.push(...fingerprints.map((item) => item.storage_path));
  }
  const paths = [...new Set([...receiptPaths(rows), ...fingerprintPaths])];
  const batch = archive ? await archiveCoupons(env, rows, action, "小票图片已按隐私要求删除，恢复时仅恢复券记录。") : null;
  let deletedFiles = 0;
  for (let index = 0; index < paths.length; index += 100) {
    deletedFiles += (await deleteReceipts(env, paths.slice(index, index + 100))).length;
  }
  let deleted = 0;
  for (let index = 0; index < codes.length; index += 100) {
    const chunk = codes.slice(index, index + 100);
    const filter = `in.(${chunk.map(encodeURIComponent).join(",")})`;
    await supabase(env, `coupons?code=${filter}`, {
      method: "DELETE",
      headers: { Prefer: "return=representation" }
    });
    deleted += chunk.length;
  }
  await audit(env, action, batch?.id || "coupons", {
    deleted,
    deletedFiles,
    batchId: batch?.id || null,
    merchantNames: merchantNamesFromCoupons(rows)
  });
  return { deleted, deletedFiles, batchId: batch?.id || null };
}

async function clearTestCoupons(env) {
  const legacyCodes = ["REP-0708-261876", "GUI-0708-138044"];
  const rows = await supabase(env, `coupons?select=*&or=(note.like.AUTO_LOAD_TEST*,code.in.(${legacyCodes.join(",")}))`);
  return deleteCouponRows(env, rows, "clear_test_coupons");
}

async function cleanupAuditCoupons(env, rawCodes, rawHashes) {
  const codes = [...new Set((Array.isArray(rawCodes) ? rawCodes : []).map((code) => String(code || "").trim().toUpperCase()).filter(Boolean))].slice(0, 200);
  const hashes = [...new Set((Array.isArray(rawHashes) ? rawHashes : []).map((hash) => String(hash || "").trim().toLowerCase()).filter((hash) => /^[0-9a-f]{64}$/.test(hash)))].slice(0, 400);
  if (hashes.length) {
    const fingerprintRows = await supabase(env, `receipt_fingerprints?select=coupon_code&content_hash=in.(${hashes.join(",")})`);
    codes.push(...fingerprintRows.map((row) => row.coupon_code));
  }
  const uniqueCodes = [...new Set(codes)];
  let result = { deleted: 0, deletedFiles: 0, batchId: null };
  if (uniqueCodes.length) {
    const filter = `in.(${uniqueCodes.map(encodeURIComponent).join(",")})`;
    const rows = await supabase(env, `coupons?select=*&code=${filter}`);
    result = await deleteCouponRows(env, rows, "cleanup_audit_coupons");
  }
  const possibleOrphanPaths = hashes.flatMap((hash) => [
    `content/${hash}.jpg`, `content/${hash}.png`, `content/${hash}.webp`
  ]);
  if (possibleOrphanPaths.length) {
    result.deletedFiles += (await deleteReceipts(env, possibleOrphanPaths)).length;
  }
  return result;
}

function bytesToBase64Url(bytes) {
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function hmac(env, value) {
  const secret = env.ADMIN_SESSION_SECRET || env.MERCHANT_AUTH_SECRET || env.ADMIN_PASSWORD;
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return bytesToBase64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value))));
}

async function confirmationToken(env, action, target, count) {
  const payload = bytesToBase64Url(encoder.encode(JSON.stringify({ action, target, count, exp: Date.now() + 5 * 60 * 1000, nonce: crypto.randomUUID() })));
  return `${payload}.${await hmac(env, payload)}`;
}

async function verifyConfirmation(env, token, action, target = "") {
  try {
    const [payload, signature] = String(token || "").split(".");
    if (!payload || signature !== await hmac(env, payload)) throw new Error();
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const parsed = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(normalized + "=".repeat((4 - normalized.length % 4) % 4)), (char) => char.charCodeAt(0))));
    if (parsed.action !== action || (target && parsed.target !== target) || parsed.exp < Date.now()) throw new Error();
    return parsed;
  } catch {
    throw Object.assign(new Error("危险操作确认已失效，请重新发起确认。"), { statusCode: 403 });
  }
}

async function prepareClearAll(env) {
  const count = await countRows(env);
  return { count, token: await confirmationToken(env, "clear_all", "coupons", count), expiresInSeconds: 300 };
}

async function clearAllCoupons(env, body) {
  if (body.confirmText !== "清空全部券数据") throw Object.assign(new Error("确认文字不正确。"), { statusCode: 400 });
  const confirmation = await verifyConfirmation(env, body.confirmToken, "clear_all", "coupons");
  const rows = await supabase(env, "coupons?select=*&order=issued_at.asc");
  if (!rows.length && confirmation.count > 0) {
    const recent = await supabase(env, "coupon_archive_batches?select=*&action=eq.clear_all_coupons&order=created_at.desc&limit=1");
    if (recent[0]?.coupon_count === confirmation.count && Date.now() - new Date(recent[0].created_at).getTime() < 10 * 60 * 1000) {
      return {
        deleted: recent[0].coupon_count,
        deletedFiles: recent[0].receipt_count,
        batchId: recent[0].id,
        recoveredAfterRetry: true
      };
    }
  }
  return deleteCouponRows(env, rows, "clear_all_coupons", { archive: true });
}

async function prepareRestore(env, batchId) {
  const rows = await supabase(env, `coupon_archive_batches?select=*&id=eq.${encodeURIComponent(batchId)}&restored_at=is.null&limit=1`);
  if (!rows[0]) throw new Error("没有可恢复的归档批次。");
  return { batch: rows[0], token: await confirmationToken(env, "restore_batch", batchId, rows[0].coupon_count), expiresInSeconds: 300 };
}

function restoredCoupon(data) {
  const note = parseReceiptNote(data.note);
  delete note.issueReceipt;
  delete note.redeemReceipt;
  return {
    ...data,
    note: JSON.stringify({ ...note, receiptsDeletedAt: new Date().toISOString(), receiptsDeletedReason: "clear_all_then_restored" })
  };
}

async function restoreBatch(env, body) {
  if (body.confirmText !== "恢复归档券数据") throw new Error("确认文字不正确。");
  await verifyConfirmation(env, body.confirmToken, "restore_batch", body.batchId);
  const archives = await supabase(env, `coupon_archives?select=coupon_data&batch_id=eq.${encodeURIComponent(body.batchId)}&order=created_at.asc`);
  if (!archives.length) throw new Error("该归档批次没有可恢复的券记录。");
  for (let index = 0; index < archives.length; index += 100) {
    await supabase(env, "coupons?on_conflict=id", {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(archives.slice(index, index + 100).map((item) => restoredCoupon(item.coupon_data)))
    });
  }
  await supabase(env, `coupon_archive_batches?id=eq.${encodeURIComponent(body.batchId)}`, {
    method: "PATCH", body: JSON.stringify({ restored_at: new Date().toISOString() })
  });
  await audit(env, "restore_coupon_batch", body.batchId, {
    restored: archives.length,
    receiptImagesRestored: false,
    merchantNames: merchantNamesFromCoupons(archives.map((item) => item.coupon_data))
  });
  return { restored: archives.length };
}

async function voidCoupon(env, code) {
  const normalized = String(code || "").trim().toUpperCase();
  if (!normalized) throw Object.assign(new Error("缺少券码，无法作废。"), { statusCode: 400 });
  const current = await supabase(env, `coupons?select=*&code=eq.${encodeURIComponent(normalized)}&status=neq.used&limit=1`);
  if (!current[0]) return { updated: 0 };
  const note = parseReceiptNote(current[0].note);
  const rows = await supabase(env, `coupons?code=eq.${encodeURIComponent(normalized)}&status=neq.used`, {
    method: "PATCH",
    body: JSON.stringify({
      status: "expired",
      end_date: new Date(Date.now() - 86400000).toISOString().slice(0, 10),
      note: JSON.stringify({ ...note, voidedAt: new Date().toISOString(), voidReason: "后台手动作废" })
    })
  });
  await audit(env, "void_coupon", normalized, {
    updated: rows?.length || 0,
    merchantName: merchantNameFromLabel(current[0].source_label)
  });
  return { updated: rows?.length || 0 };
}

async function deleteMerchant(env, id) {
  const normalized = String(id || "").trim();
  if (!normalized) throw Object.assign(new Error("缺少商户 ID，无法删除。"), { statusCode: 400 });
  const current = await supabase(env, `merchants?select=id,name&id=eq.${encodeURIComponent(normalized)}&limit=1`);
  const rows = await supabase(env, `merchants?id=eq.${encodeURIComponent(normalized)}`, { method: "DELETE" });
  const merchantName = current[0]?.name || "已删除商户";
  await audit(env, "delete_merchant", merchantName, { deleted: rows?.length || 0, merchantName });
  return { deleted: rows?.length || 0 };
}

async function exportCoupons(env, rawFilters) {
  const filters = normalizeFilters({ ...rawFilters, page: 1, pageSize: 100 });
  const rows = [];
  for (let offset = 0; ; offset += 1000) {
    const query = couponQuery(filters, { paging: false }) + `&limit=1000&offset=${offset}`;
    const page = await supabase(env, query);
    rows.push(...page);
    if (page.length < 1000) break;
    if (rows.length >= 20000) throw new Error("当前筛选结果超过 20000 条，请缩小日期范围后导出。");
  }
  await audit(env, "export_coupons", "filtered", {
    count: rows.length,
    filters,
    merchantNames: merchantNamesFromCoupons(rows)
  });
  return { coupons: rows.map(presentCoupon), filters };
}

export async function onRequestPost({ request, env }) {
  try {
    const body = await readBody(request);
    await assertAdmin(env, request, body.password);
    if (body.action === "save") {
      await saveConfig(env, body.data || {});
      return json({ ok: true });
    }
    if (body.action === "clearTestCoupons") return json({ ok: true, data: await clearTestCoupons(env) });
    if (body.action === "cleanupAuditCoupons") return json({ ok: true, data: await cleanupAuditCoupons(env, body.data?.codes, body.data?.receiptHashes) });
    if (body.action === "prepareClearAll") return json({ ok: true, data: await prepareClearAll(env) });
    if (body.action === "clearAllCoupons") return json({ ok: true, data: await clearAllCoupons(env, body.data || {}) });
    if (body.action === "prepareRestore") return json({ ok: true, data: await prepareRestore(env, body.data?.batchId) });
    if (body.action === "restoreBatch") return json({ ok: true, data: await restoreBatch(env, body.data || {}) });
    if (body.action === "voidCoupon") return json({ ok: true, data: await voidCoupon(env, body.code || body.data?.code) });
    if (body.action === "deleteMerchant") return json({ ok: true, data: await deleteMerchant(env, body.id || body.data?.id) });
    if (body.action === "exportCoupons") return json({ ok: true, data: await exportCoupons(env, body.data?.filters || {}) });
    if (body.action === "receiptUrl") return json({ ok: true, data: { url: await signedReceiptUrl(env, body.data?.path) } });
    return json({ ok: true, data: await loadConfig(env, body.data?.filters || {}) });
  } catch (err) {
    return json({ ok: false, message: err.message || "后台请求失败。" }, err.statusCode || 400);
  }
}
