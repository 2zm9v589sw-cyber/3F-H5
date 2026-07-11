import { json, parseActivityContents, supabase } from "../_shared.js";

export async function onRequestGet({ env }) {
  try {
    const [settings, merchants, couponTypes, thresholdRules] = await Promise.all([
      supabase(env, "activity_settings?select=*&id=eq.main"),
      supabase(env, "merchants?select=*&active=eq.true&order=sort_order.asc,name.asc"),
      supabase(env, "coupon_types?select=*&active=eq.true&order=sort_order.asc"),
      supabase(env, "threshold_rules?select=*&active=eq.true&order=sort_order.asc")
    ]);
    const setting = settings[0] || {};
    const saved = parseActivityContents(setting);
    delete setting.admin_password_hash;
    return json({
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
    }, 200, "public, max-age=30, s-maxage=30, stale-while-revalidate=120");
  } catch (err) {
    return json({ ok: false, message: err.message || "读取活动配置失败。" }, 400);
  }
}
