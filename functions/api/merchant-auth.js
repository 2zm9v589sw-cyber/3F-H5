import { assertAuthAllowed, json, readBody, recordAuthFailure } from "../_shared.js";
import { createMerchantToken, merchantAccessCode, merchantSessionExpiresAt } from "../_merchant-session.js";
import { supabase } from "../_shared.js";

export async function onRequestPost({ request, env }) {
  let throttleKey = "";
  try {
    const body = await readBody(request);
    const merchantId = String(body.merchantId || "").trim();
    const merchants = await supabase(env, `merchants?select=*&id=eq.${encodeURIComponent(merchantId)}&active=eq.true&limit=1`);
    const merchant = merchants[0];
    if (!merchant || (!merchant.can_issue && !merchant.can_redeem)) {
      throttleKey = await assertAuthAllowed(env, request, "merchant", merchantId);
      await recordAuthFailure(env, throttleKey);
      await new Promise((resolve) => setTimeout(resolve, 650));
      return json({ ok: false, message: "该商户未开通活动操作权限。" }, 403);
    }
    const expectedCode = await merchantAccessCode(env, merchant);
    if (String(body.password || "").trim().toUpperCase() !== expectedCode) {
      throttleKey = await assertAuthAllowed(env, request, "merchant", merchantId);
      await recordAuthFailure(env, throttleKey);
      await new Promise((resolve) => setTimeout(resolve, 650));
      return json({ ok: false, message: "商户口令错误。" }, 401);
    }
    return json({
      ok: true,
      token: await createMerchantToken(env, merchant.id),
      expiresAt: merchantSessionExpiresAt() * 1000,
      merchant: {
        id: merchant.id,
        shop_code: merchant.shop_code,
        name: merchant.name,
        category_key: merchant.category_key,
        category_name: merchant.category_name,
        can_issue: merchant.can_issue,
        can_redeem: merchant.can_redeem,
        is_guide_point: merchant.is_guide_point,
        activity_content: merchant.activity_content || ""
      }
    });
  } catch (err) {
    return json({ ok: false, message: err.message || "商户口令校验失败。" }, err.statusCode || 400);
  }
}
