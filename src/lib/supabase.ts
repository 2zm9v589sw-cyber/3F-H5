const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function assertEnv() {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    throw new Error("缺少 Supabase 环境变量，请配置 SUPABASE_URL 和 SUPABASE_SERVICE_ROLE_KEY。");
  }
}

type QueryValue = string | number | boolean | null | undefined;

function queryString(query?: Record<string, QueryValue>) {
  if (!query) return "";
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") params.set(key, String(value));
  });
  const text = params.toString();
  return text ? `?${text}` : "";
}

async function request<T>(path: string, init: RequestInit = {}) {
  assertEnv();
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY!,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(init.headers || {})
    },
    cache: "no-store"
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(text || `Supabase 请求失败：${res.status}`);
  }
  return (text ? JSON.parse(text) : null) as T;
}

export async function selectRows<T>(table: string, query?: Record<string, QueryValue>) {
  return request<T[]>(`${table}${queryString(query)}`);
}

export async function insertRows<T>(table: string, rows: unknown[]) {
  return request<T[]>(table, { method: "POST", body: JSON.stringify(rows) });
}

export async function patchRows<T>(table: string, match: Record<string, QueryValue>, values: Record<string, unknown>) {
  return request<T[]>(`${table}${queryString(match)}`, { method: "PATCH", body: JSON.stringify(values) });
}

export async function deleteRows<T>(table: string, match: Record<string, QueryValue>) {
  return request<T[]>(`${table}${queryString(match)}`, { method: "DELETE" });
}

export async function upsertRows<T>(table: string, rows: unknown[], onConflict = "id") {
  return request<T[]>(`${table}?on_conflict=${encodeURIComponent(onConflict)}`, {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify(rows.map((row) => row))
  });
}

export function eq(value: string) {
  return `eq.${value}`;
}

export function order(value: string) {
  return value;
}
