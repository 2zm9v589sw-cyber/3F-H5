export const ACTIVITY_CONTENT_PREFIX = "merchant_activity_content:";

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
