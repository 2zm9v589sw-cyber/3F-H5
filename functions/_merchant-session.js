const encoder = new TextEncoder();

function bytesToBase64Url(bytes) {
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function stringToBase64Url(value) {
  return bytesToBase64Url(encoder.encode(value));
}

function base64UrlToString(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  const bytes = Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

async function digest(value) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

async function hmac(secret, value) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}

export function merchantSecret(env) {
  return env.MERCHANT_AUTH_SECRET || env.MERCHANT_PASSWORD || "";
}

export async function merchantAccessCode(env, merchant) {
  const secret = merchantSecret(env);
  if (!secret) throw new Error("商户鉴权密钥未配置。");
  const bytes = await digest(`${secret}:${merchant.id}:${merchant.shop_code || ""}`);
  const value = ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0;
  return String(100000 + (value % 900000));
}

export async function createMerchantToken(env, merchantId) {
  const secret = merchantSecret(env);
  const payload = stringToBase64Url(JSON.stringify({
    merchantId,
    exp: merchantSessionExpiresAt()
  }));
  const signature = bytesToBase64Url(await hmac(secret, payload));
  return `${payload}.${signature}`;
}

export function merchantSessionExpiresAt() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return Math.floor((Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day) + 1) - 8 * 60 * 60 * 1000) / 1000);
}

export async function verifyMerchantToken(env, token) {
  const secret = merchantSecret(env);
  if (!secret || !token || !token.includes(".")) throw new Error("商户登录已失效，请重新登录。");
  const [payload, suppliedSignature] = token.split(".");
  const expectedSignature = bytesToBase64Url(await hmac(secret, payload));
  if (suppliedSignature !== expectedSignature) throw new Error("商户登录已失效，请重新登录。");
  const parsed = JSON.parse(base64UrlToString(payload));
  if (!parsed.merchantId || Number(parsed.exp || 0) < Math.floor(Date.now() / 1000)) {
    throw new Error("商户登录已过期，请重新登录。");
  }
  return parsed;
}

export function bearerToken(request) {
  const authorization = request.headers.get("Authorization") || "";
  return authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
}
