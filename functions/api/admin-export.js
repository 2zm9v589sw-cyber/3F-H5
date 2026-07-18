import { json, readBody, supabase } from "../_shared.js";
import { parseReceiptNote } from "../_receipt.js";

function assertAdmin(env, password) {
  if (!env.ADMIN_PASSWORD || password !== env.ADMIN_PASSWORD) {
    const err = new Error("后台密码错误。");
    err.statusCode = 401;
    throw err;
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
    keyword: String(raw.keyword || "").trim().slice(0, 80),
    status: ["unused", "used", "expired"].includes(raw.status) ? raw.status : "all",
    type: String(raw.type || "all").trim(),
    from: /^\d{4}-\d{2}-\d{2}$/.test(raw.from || "") ? raw.from : "",
    to: /^\d{4}-\d{2}-\d{2}$/.test(raw.to || "") ? raw.to : ""
  };
}

function query(filters, offset) {
  const fields = [
    "code", "coupon_type_name", "source_label", "issued_category_key", "issued_at",
    "status", "start_date", "end_date", "redeem_point_label", "redeemed_at", "note"
  ].join(",");
  const parts = [`select=${fields}`, "order=issued_at.desc"];
  if (filters.keyword) {
    const value = encodeURIComponent(`*${filters.keyword.replace(/[,*()]/g, " ")}*`);
    parts.push(`or=(code.ilike.${value},source_label.ilike.${value},redeem_point_label.ilike.${value},coupon_type_name.ilike.${value})`);
  }
  if (filters.type !== "all") parts.push(`coupon_type_code=eq.${encodeURIComponent(filters.type)}`);
  if (filters.from) parts.push(`issued_at=gte.${encodeURIComponent(`${filters.from}T00:00:00+08:00`)}`);
  if (filters.to) parts.push(`issued_at=lt.${encodeURIComponent(`${nextDate(filters.to)}T00:00:00+08:00`)}`);
  if (filters.status === "used") parts.push("status=eq.used");
  if (filters.status === "unused") parts.push(`status=eq.unused&end_date=gte.${shanghaiDate()}`);
  if (filters.status === "expired") parts.push(`or=(status.eq.expired,and(status.eq.unused,end_date.lt.${shanghaiDate()}))`);
  parts.push("limit=1000", `offset=${offset}`);
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

function merchantNames(rows) {
  return [...new Set(rows.map((row) => {
    const parts = String(row.source_label || "").split(/\s*[|｜]\s*/).filter(Boolean);
    return (parts.length > 1 ? parts.at(-1) : parts[0] || "").trim();
  }).filter(Boolean))];
}

async function recordExport(env, rows, filters) {
  await supabase(env, "admin_audit_logs", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      action: "export_coupons",
      target: "filtered",
      detail: { count: rows.length, filters, merchantNames: merchantNames(rows) }
    })
  });
}

export async function onRequestPost({ request, env }) {
  try {
    const body = await readBody(request);
    assertAdmin(env, body.password);
    const filters = normalize(body.data?.filters || {});
    const rows = [];
    for (let offset = 0; offset < 20000; offset += 1000) {
      const page = await supabase(env, query(filters, offset));
      rows.push(...page);
      if (page.length < 1000) break;
    }
    if (rows.length >= 20000) throw new Error("当前筛选结果达到20000条，请缩小日期范围后导出。");
    await recordExport(env, rows, filters).catch(() => {});
    return json({ ok: true, data: { coupons: rows.map(present), filters } });
  } catch (err) {
    return json({ ok: false, message: err.message || "导出数据失败。" }, err.statusCode || 400);
  }
}
