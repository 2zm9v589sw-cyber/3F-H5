import { json, readBody } from "../_shared.js";

export async function onRequestPost({ request, env }) {
  try {
    const body = await readBody(request);
    if (!env.MERCHANT_PASSWORD) {
      return json({ ok: false, message: "商户口令未配置，请联系管理人员。" }, 500);
    }
    if (body.password !== env.MERCHANT_PASSWORD) {
      return json({ ok: false, message: "商户口令错误。" }, 401);
    }
    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, message: err.message || "商户口令校验失败。" }, 400);
  }
}
