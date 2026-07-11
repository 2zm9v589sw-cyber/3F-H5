const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

const json = (statusCode, body) => ({
  statusCode,
  headers: { "Content-Type": "application/json; charset=utf-8" },
  body: JSON.stringify(body)
});

const ACTIVITY_CONTENT_PREFIX = "merchant_activity_content:";

function assertAdmin(password) {
  if (!ADMIN_PASSWORD || password !== ADMIN_PASSWORD) {
    const err = new Error("后台密码错误。");
    err.statusCode = 401;
    throw err;
  }
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

function stringifyActivityContents(merchants) {
  const entries = {};
  merchants.forEach((merchant) => {
    const content = String(merchant.activity_content || "").trim();
    if (merchant.id && content) entries[merchant.id] = content;
  });
  return ACTIVITY_CONTENT_PREFIX + JSON.stringify(entries);
}

function mergeActivityContents(merchants, setting) {
  const saved = parseActivityContents(setting);
  return merchants.map((merchant) => ({
    ...merchant,
    activity_content: saved[merchant.id] || merchant.activity_content || ""
  }));
}

async function supabase(path, init = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(init.headers || {})
    }
  });
  const text = await res.text();
  if (!res.ok) throw new Error(text || `Supabase 请求失败：${res.status}`);
  return text ? JSON.parse(text) : null;
}

function statusOf(coupon) {
  if (coupon.status === "used") return "used";
  if (coupon.status === "expired") return "expired";
  const today = new Date().toISOString().slice(0, 10);
  if (today > coupon.end_date) return "expired";
  return "unused";
}

async function loadConfig() {
  const [settings, merchants, couponTypes, thresholdRules, coupons] = await Promise.all([
    supabase("activity_settings?select=*&id=eq.main"),
    supabase("merchants?select=*&order=sort_order.asc,name.asc"),
    supabase("coupon_types?select=*&order=sort_order.asc"),
    supabase("threshold_rules?select=*&order=sort_order.asc"),
    supabase("coupons?select=*&order=issued_at.desc")
  ]);
  const setting = settings[0];
  return {
    setting,
    merchants: mergeActivityContents(merchants, setting),
    couponTypes,
    thresholdRules,
    coupons: coupons.map((coupon) => ({ ...coupon, computedStatus: statusOf(coupon) }))
  };
}

async function upsert(table, rows) {
  if (!rows.length) return [];
  return supabase(`${table}?on_conflict=id`, {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify(rows)
  });
}

function withoutActivityContent(rows) {
  return rows.map(({ activity_content, ...row }) => row);
}

function isMissingActivityContentColumn(err) {
  return String(err.message || "").includes("activity_content") && String(err.message || "").includes("PGRST204");
}

async function saveConfig(body) {
  const { setting, merchants = [], couponTypes = [], thresholdRules = [] } = body;
  await supabase("activity_settings?id=eq.main", {
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

  const merchantRows = merchants.map((m, idx) => ({
    ...m,
    activity_content: m.activity_content || "",
    sort_order: Number(m.sort_order ?? idx),
    active: Boolean(m.active),
    can_issue: Boolean(m.can_issue),
    can_redeem: Boolean(m.can_redeem),
    is_guide_point: Boolean(m.is_guide_point),
    updated_at: new Date().toISOString()
  }));

  try {
    await upsert("merchants", merchantRows);
  } catch (err) {
    if (!isMissingActivityContentColumn(err)) throw err;
    await upsert("merchants", withoutActivityContent(merchantRows));
  }

  await upsert("coupon_types", couponTypes.map((t, idx) => ({
    ...t,
    sort_order: Number(t.sort_order ?? idx),
    active: Boolean(t.active),
    updated_at: new Date().toISOString()
  })));

  await upsert("threshold_rules", thresholdRules.map((r, idx) => ({
    ...r,
    min_amount: Number(r.min_amount || 0),
    sort_order: Number(r.sort_order ?? idx),
    active: Boolean(r.active),
    updated_at: new Date().toISOString()
  })));
}

const LEGACY_TEST_COUPON_CODES = ["REP-0708-261876", "GUI-0708-138044"];

async function deleteCoupons(path) {
  return supabase(path, {
    method: "DELETE"
  });
}

async function clearTestCoupons() {
  const autoRows = await deleteCoupons("coupons?note=like.AUTO_LOAD_TEST*");
  const legacyRows = await deleteCoupons(`coupons?code=in.(${LEGACY_TEST_COUPON_CODES.join(",")})`);
  return {
    deleted: (autoRows?.length || 0) + (legacyRows?.length || 0),
    autoDeleted: autoRows?.length || 0,
    legacyDeleted: legacyRows?.length || 0
  };
}

async function clearAllCoupons() {
  const rows = await deleteCoupons("coupons?id=not.is.null");
  return { deleted: rows?.length || 0 };
}

async function voidCoupon(code) {
  const normalized = String(code || "").trim().toUpperCase();
  if (!normalized) {
    const err = new Error("缺少券码，无法作废。");
    err.statusCode = 400;
    throw err;
  }
  const rows = await supabase(`coupons?code=eq.${encodeURIComponent(normalized)}&status=neq.used`, {
    method: "PATCH",
    body: JSON.stringify({
      status: "expired",
      end_date: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      note: "后台手动作废"
    })
  });
  return { updated: rows?.length || 0 };
}

async function deleteMerchant(id) {
  const normalized = String(id || "").trim();
  if (!normalized) {
    const err = new Error("缺少商户 ID，无法删除。");
    err.statusCode = 400;
    throw err;
  }
  const rows = await supabase(`merchants?id=eq.${encodeURIComponent(normalized)}`, {
    method: "DELETE"
  });
  return { deleted: rows?.length || 0 };
}

exports.handler = async (event) => {
  try {
    const body = event.body ? JSON.parse(event.body) : {};
    assertAdmin(body.password);
    if (body.action === "save") {
      await saveConfig(body.data || {});
      return json(200, { ok: true });
    }
    if (body.action === "clearTestCoupons") {
      return json(200, { ok: true, data: await clearTestCoupons() });
    }
    if (body.action === "clearAllCoupons") {
      return json(200, { ok: true, data: await clearAllCoupons() });
    }
    if (body.action === "voidCoupon") {
      return json(200, { ok: true, data: await voidCoupon(body.code || body.data?.code) });
    }
    if (body.action === "deleteMerchant") {
      return json(200, { ok: true, data: await deleteMerchant(body.id || body.data?.id) });
    }
    return json(200, { ok: true, data: await loadConfig() });
  } catch (err) {
    return json(err.statusCode || 400, { ok: false, message: err.message || "后台请求失败。" });
  }
};
