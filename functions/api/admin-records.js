import { json, readBody, supabaseWithMeta } from "../_shared.js";
import { parseReceiptNote } from "../_receipt.js";

function assertAdmin(env, password) {
  if (!env.ADMIN_PASSWORD || password !== env.ADMIN_PASSWORD) {
    const error = new Error("后台密码错误。");
    error.statusCode = 401;
    throw error;
  }
}

function shanghaiDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit"
  }).format(new Date());
}

function nextDate(dateText) {
  const date = new Date(`${dateText}T00:00:00+08:00`);
  date.setUTCDate(date.getUTCDate() + 1);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit"
  }).format(date);
}

function normalize(raw = {}) {
  return {
    page: Math.max(1, Number(raw.page) || 1),
    pageSize: Math.min(100, Math.max(10, Number(raw.pageSize) || 30)),
    keyword: String(raw.keyword || "").trim().slice(0, 80),
    status: ["unused", "used", "expired"].includes(raw.status) ? raw.status : "all",
    type: String(raw.type || "all").trim(),
    from: /^\d{4}-\d{2}-\d{2}$/.test(raw.from || "") ? raw.from : "",
    to: /^\d{4}-\d{2}-\d{2}$/.test(raw.to || "") ? raw.to : ""
  };
}

function query(filters, mode) {
  const fields = [
    "code", "coupon_type_code", "coupon_type_name", "source_label", "issued_category_key",
    "issued_at", "status", "start_date", "end_date", "redeem_point_label", "redeemed_at", "note"
  ].join(",");
  const parts = [`select=${fields}`, "order=issued_at.desc"];
  if (filters.keyword) {
    const value = encodeURIComponent(`*${filters.keyword.replace(/[,*()]/g, " ")}*`);
    parts.push(`or=(code.ilike.${value},source_label.ilike.${value},redeem_point_label.ilike.${value},coupon_type_name.ilike.${value})`);
  }
  if (filters.type !== "all") parts.push(`coupon_type_code=eq.${encodeURIComponent(filters.type)}`);
  if (filters.from) parts.push(`issued_at=gte.${encodeURIComponent(`${filters.from}T00:00:00+08:00`)}`);
  if (filters.to) parts.push(`issued_at=lt.${encodeURIComponent(`${nextDate(filters.to)}T00:00:00+08:00`)}`);
  if (mode === "redeemed" || filters.status === "used") parts.push("status=eq.used");
  if (mode !== "redeemed" && filters.status === "all") parts.push("status=not.is.null");
  if (mode !== "redeemed" && filters.status === "unused") parts.push(`status=eq.unused&end_date=gte.${shanghaiDate()}`);
  if (mode !== "redeemed" && filters.status === "expired") parts.push(`or=(status.eq.expired,and(status.eq.unused,end_date.lt.${shanghaiDate()}))`);
  parts.push(`limit=${filters.pageSize}`, `offset=${(filters.page - 1) * filters.pageSize}`);
  return `coupons?${parts.join("&")}`;
}

function present(coupon) {
  const note = parseReceiptNote(coupon.note);
  const expired = coupon.status === "expired" || (coupon.status === "unused" && shanghaiDate() > coupon.end_date);
  return {
    ...coupon,
    note_text: note.issueReceipt || note.redeemReceipt ? "" : coupon.note,
    issue_receipt_path: note.issueReceipt?.path || "",
    redeem_receipt_path: note.redeemReceipt?.path || "",
    issue_proof_type: note.issueReceipt?.proofType || "",
    redeem_proof_type: note.redeemReceipt?.proofType || "",
    computedStatus: coupon.status === "used" ? "used" : expired ? "expired" : "unused"
  };
}

export async function onRequestPost({ request, env }) {
  try {
    const body = await readBody(request);
    assertAdmin(env, body.password);
    const mode = body.data?.mode === "redeemed" ? "redeemed" : "issued";
    const filters = normalize(body.data?.filters || {});
    const result = await supabaseWithMeta(env, query(filters, mode), { headers: { Prefer: "count=exact" } });
    return json({
      ok: true,
      data: { coupons: (result.data || []).map(present), total: result.count, page: filters.page, pageSize: filters.pageSize }
    });
  } catch (error) {
    return json({ ok: false, message: error.message || "券记录加载失败。" }, error.statusCode || 400);
  }
}
