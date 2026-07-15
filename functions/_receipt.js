import { supabase } from "./_shared.js";

const BUCKET = "receipt-images";
const MAX_RECEIPT_BYTES = 2 * 1024 * 1024;

function parseReceiptNote(note) {
  try {
    const parsed = JSON.parse(note || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function hammingDistance(a, b) {
  if (!a || !b || a.length !== b.length) return Number.MAX_SAFE_INTEGER;
  let distance = 0;
  for (let index = 0; index < a.length; index += 1) {
    const left = Number.parseInt(a[index], 16);
    const right = Number.parseInt(b[index], 16);
    let value = left ^ right;
    while (value) {
      distance += value & 1;
      value >>= 1;
    }
  }
  return distance;
}

function decodeReceipt(receipt) {
  const match = String(receipt?.dataUrl || "").match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/);
  if (!match) throw new Error("请现场拍摄消费凭证后再提交。");
  const bytes = Uint8Array.from(atob(match[2]), (char) => char.charCodeAt(0));
  if (!bytes.length || bytes.length > MAX_RECEIPT_BYTES) throw new Error("消费凭证图片过大，请重新拍摄。");
  if (!/^[0-9a-f]{16}$/i.test(String(receipt?.perceptualHash || ""))) {
    throw new Error("消费凭证图片指纹无效，请重新拍摄。");
  }
  return { mime: match[1], bytes, perceptualHash: receipt.perceptualHash.toLowerCase() };
}

async function sha256Hex(bytes) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function ensureBucket(env) {
  const res = await fetch(`${env.SUPABASE_URL}/storage/v1/bucket`, {
    method: "POST",
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ id: BUCKET, name: BUCKET, public: false, file_size_limit: MAX_RECEIPT_BYTES })
  });
  if (!res.ok && res.status !== 409 && !String(await res.text()).includes("already exists")) {
    throw new Error("小票存储初始化失败。");
  }
}

export async function assertUniqueReceipt(env, receipt) {
  const decoded = decodeReceipt(receipt);
  const contentHash = await sha256Hex(decoded.bytes);
  const coupons = [];
  for (let offset = 0; ; offset += 1000) {
    const page = await supabase(env, `coupons?select=code,note&note=not.is.null&order=issued_at.desc&limit=1000&offset=${offset}`);
    coupons.push(...page);
    if (page.length < 1000) break;
  }
  for (const coupon of coupons) {
    const note = parseReceiptNote(coupon.note);
    for (const saved of [note.issueReceipt, note.redeemReceipt]) {
      if (!saved) continue;
      if (saved.contentHash === contentHash || hammingDistance(saved.perceptualHash, decoded.perceptualHash) <= 5) {
        throw new Error(`该消费凭证疑似已使用（关联券码 ${coupon.code}），不能重复提交。`);
      }
    }
  }
  return { ...decoded, contentHash };
}

export async function storeReceipt(env, decoded, merchant, kind, couponCode) {
  const extension = decoded.mime === "image/png" ? "png" : decoded.mime === "image/webp" ? "webp" : "jpg";
  const path = `content/${decoded.contentHash}.${extension}`;
  const res = await fetch(`${env.SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
    method: "POST",
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": decoded.mime,
      "x-upsert": "false"
    },
    body: decoded.bytes
  });
  if (!res.ok) {
    const errorText = await res.text();
    if (res.status === 409 || /duplicate|already exists|resource exists/i.test(errorText)) {
      throw new Error("该消费凭证已提交过，不能重复使用。");
    }
    throw new Error("小票照片上传失败，请重试。");
  }
  return {
    path,
    contentHash: decoded.contentHash,
    perceptualHash: decoded.perceptualHash,
    merchantId: merchant.id,
    merchantLabel: `${merchant.shop_code}｜${merchant.name}`,
    capturedAt: new Date().toISOString()
  };
}

export async function deleteReceipt(env, path) {
  return deleteReceipts(env, path ? [path] : []);
}

export async function deleteReceipts(env, paths) {
  const prefixes = [...new Set(paths.filter(Boolean))];
  if (!prefixes.length) return [];
  const res = await fetch(`${env.SUPABASE_URL}/storage/v1/object/${BUCKET}`, {
    method: "DELETE",
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ prefixes })
  });
  if (!res.ok) throw new Error("小票照片清理失败。");
  return res.json().catch(() => []);
}

export async function signedReceiptUrl(env, path) {
  if (!path) throw new Error("小票路径不存在。");
  const res = await fetch(`${env.SUPABASE_URL}/storage/v1/object/sign/${BUCKET}/${path}`, {
    method: "POST",
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ expiresIn: 600 })
  });
  const body = await res.json();
  if (!res.ok || !body.signedURL) throw new Error("生成小票查看链接失败。");
  return `${env.SUPABASE_URL}/storage/v1${body.signedURL}`;
}

export { parseReceiptNote };
