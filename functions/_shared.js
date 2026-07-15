export const ACTIVITY_CONTENT_PREFIX = "merchant_activity_content:";

const authFailures = new Map();
const AUTH_WINDOW_MS = 10 * 60 * 1000;
const AUTH_LIMIT = 8;
const encoder = new TextEncoder();

export function json(body, status = 200, cacheControl = "no-store") {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": cacheControl
    }
  });
}

export async function readBody(request) {
  if (!request.body) return {};
  try {
    return await request.json();
  } catch {
    return {};
  }
}

function requestIp(request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return request.headers.get("eo-client-ip") || request.headers.get("cf-connecting-ip") || request.headers.get("x-real-ip") || forwarded || "";
}

function base64Url(bytes) {
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function authThrottleKey(env, request, scope, subject) {
  const ip = requestIp(request);
  const source = ip || `unknown:${request.headers.get("user-agent") || ""}`;
  const secret = env.MERCHANT_AUTH_SECRET || env.ADMIN_SESSION_SECRET || env.ADMIN_PASSWORD || "auth-throttle";
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(`${scope}:${source}:${subject}`));
  return base64Url(new Uint8Array(signature));
}

export async function assertAuthAllowed(env, request, scope, subject = "") {
  const key = await authThrottleKey(env, request, scope, subject);
  const now = Date.now();
  const entry = authFailures.get(key);
  if (entry && now - entry.startedAt < AUTH_WINDOW_MS && entry.count >= AUTH_LIMIT) {
    const remainingMinutes = Math.max(1, Math.ceil((AUTH_WINDOW_MS - (now - entry.startedAt)) / 60000));
    const err = new Error(`连续输入错误次数过多，请${remainingMinutes}分钟后再试。`);
    err.statusCode = 429;
    throw err;
  }
  const cutoff = new Date(now - AUTH_WINDOW_MS).toISOString();
  const rows = await supabase(env, `admin_audit_logs?select=id,created_at&action=eq.auth_failure&target=eq.${encodeURIComponent(key)}&created_at=gte.${encodeURIComponent(cutoff)}&order=created_at.asc&limit=${AUTH_LIMIT}`);
  if (rows.length >= AUTH_LIMIT) {
    const remainingMinutes = Math.max(1, Math.ceil((AUTH_WINDOW_MS - (now - new Date(rows[0].created_at).getTime())) / 60000));
    authFailures.set(key, { count: rows.length, startedAt: new Date(rows[0].created_at).getTime() });
    const err = new Error(`连续输入错误次数过多，请${remainingMinutes}分钟后再试。`);
    err.statusCode = 429;
    throw err;
  }
  authFailures.set(key, { count: rows.length, startedAt: rows[0] ? new Date(rows[0].created_at).getTime() : now });
  return key;
}

export async function recordAuthFailure(env, key) {
  if (!key) return;
  const now = Date.now();
  const current = authFailures.get(key);
  if (!current || now - current.startedAt >= AUTH_WINDOW_MS) {
    authFailures.set(key, { count: 1, startedAt: now });
  } else {
    current.count += 1;
  }
  await supabase(env, "admin_audit_logs", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ action: "auth_failure", target: key, detail: {} })
  });
  if (authFailures.size > 2000) {
    for (const [entryKey, entry] of authFailures) {
      if (now - entry.startedAt >= AUTH_WINDOW_MS) authFailures.delete(entryKey);
    }
  }
}

export async function clearAuthFailures(env, key) {
  if (!key) return;
  authFailures.delete(key);
  await supabase(env, `admin_audit_logs?action=eq.auth_failure&target=eq.${encodeURIComponent(key)}`, { method: "DELETE" });
}

export async function supabase(env, path, init = {}) {
  return (await supabaseWithMeta(env, path, init)).data;
}

export async function supabaseWithMeta(env, path, init = {}) {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("云端数据库环境变量未配置。");
  const res = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(init.headers || {})
    }
  });
  const text = await res.text();
  if (!res.ok) throw new Error(text || `Supabase 请求失败：${res.status}`);
  return {
    data: text ? JSON.parse(text) : null,
    count: Number((res.headers.get("Content-Range") || "").split("/")[1]) || 0,
    headers: res.headers
  };
}

export function parseActivityContents(setting) {
  const raw = setting?.admin_password_hash || "";
  if (!raw.startsWith(ACTIVITY_CONTENT_PREFIX)) return {};
  try {
    return JSON.parse(raw.slice(ACTIVITY_CONTENT_PREFIX.length)) || {};
  } catch {
    return {};
  }
}
