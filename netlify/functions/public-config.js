const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const ACTIVITY_CONTENT_PREFIX = "merchant_activity_content:";

const json = (statusCode, body) => ({
  statusCode,
  headers: {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "public, max-age=30, s-maxage=30, stale-while-revalidate=120"
  },
  body: JSON.stringify(body)
});

async function supabase(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      ...(init.headers || {})
    }
  });
  const text = await res.text();
  if (!res.ok) throw new Error(text || `Supabase 请求失败：${res.status}`);
  return text ? JSON.parse(text) : null;
}

function parseActivityContents(setting) {
  const raw = setting?.admin_password_hash || "";
  if (!raw.startsWith(ACTIVITY_CONTENT_PREFIX)) return {};
  try {
    return JSON.parse(raw.slice(ACTIVITY_CONTENT_PREFIX.length)) || {};
  } catch {
    return {};
  }
}

exports.handler = async () => {
  try {
    const [settings, merchants, couponTypes, thresholdRules] = await Promise.all([
      supabase("activity_settings?select=*&id=eq.main"),
      supabase("merchants?select=*&active=eq.true&order=sort_order.asc,name.asc"),
      supabase("coupon_types?select=*&active=eq.true&order=sort_order.asc"),
      supabase("threshold_rules?select=*&active=eq.true&order=sort_order.asc")
    ]);
    const setting = settings[0] || {};
    const saved = parseActivityContents(setting);
    delete setting.admin_password_hash;
    return json(200, {
      ok: true,
      data: {
        setting,
        merchants: merchants.map((merchant) => ({
          ...merchant,
          activity_content: saved[merchant.id] || merchant.activity_content || ""
        })),
        couponTypes,
        thresholdRules
      }
    });
  } catch (err) {
    return json(400, { ok: false, message: err.message || "读取活动配置失败。" });
  }
};
