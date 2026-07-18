import fs from "node:fs";

const apply = process.argv.includes("--apply");
const envPath = process.argv.find((arg) => arg.endsWith(".json"));
const fileEnv = envPath ? JSON.parse(fs.readFileSync(envPath, "utf8")) : {};
const env = fileEnv.variables || fileEnv;
const supabaseUrl = process.env.SUPABASE_URL || env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  throw new Error("请通过环境变量或 JSON 文件提供 Supabase 配置。");
}

const headers = {
  apikey: serviceKey,
  Authorization: `Bearer ${serviceKey}`,
  "Content-Type": "application/json"
};

async function rest(path, init = {}) {
  const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    ...init,
    headers: { ...headers, ...(init.headers || {}) }
  });
  const text = await response.text();
  if (!response.ok) throw new Error(text || `Supabase 请求失败：${response.status}`);
  return text ? JSON.parse(text) : null;
}

function parseNote(value) {
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

const coupons = await rest("coupons?select=code,source_merchant_id,source_label,note&order=issued_at.asc&limit=1000");
const fingerprints = await rest("receipt_fingerprints?select=*&receipt_kind=eq.issue&order=created_at.asc&limit=1000");
const fingerprintsByCode = new Map(fingerprints.map((row) => [row.coupon_code, row]));
const missing = coupons.filter((coupon) => !parseNote(coupon.note).issueReceipt?.path && fingerprintsByCode.has(coupon.code));

if (!apply) {
  console.log(JSON.stringify({ mode: "dry-run", missingLinks: missing.length, codes: missing.map((row) => row.code) }, null, 2));
  process.exit(0);
}

let repaired = 0;
for (const coupon of missing) {
  const fingerprint = fingerprintsByCode.get(coupon.code);
  const note = parseNote(coupon.note);
  const issueReceipt = {
    path: fingerprint.storage_path,
    contentHash: fingerprint.content_hash,
    perceptualHash: fingerprint.perceptual_hash,
    merchantId: fingerprint.merchant_id || coupon.source_merchant_id,
    merchantLabel: coupon.source_label,
    capturedAt: fingerprint.created_at
  };
  const rows = await rest(`coupons?code=eq.${encodeURIComponent(coupon.code)}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      note: JSON.stringify({ ...note, issueReceipt, receiptConsentAt: note.receiptConsentAt || fingerprint.created_at })
    })
  });
  if (!rows?.[0]) throw new Error(`券码 ${coupon.code} 的凭证关联修复失败。`);
  repaired += 1;
}

console.log(JSON.stringify({ mode: "apply", repaired }, null, 2));
