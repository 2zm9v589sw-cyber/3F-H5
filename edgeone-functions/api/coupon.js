import { onRequestGet, onRequestPost } from "../core/api/coupon.js";
import { runtimeEnv } from "../_runtime-env.js";

export default function onRequest(context) {
  if (context.request.method === "GET") return onRequestGet({ ...context, env: runtimeEnv });
  if (context.request.method === "POST") return onRequestPost({ ...context, env: runtimeEnv });
  return new Response(JSON.stringify({ ok: false, message: "请求方法不允许。" }), {
    status: 405,
    headers: { "Content-Type": "application/json; charset=utf-8", Allow: "GET, POST" }
  });
}
