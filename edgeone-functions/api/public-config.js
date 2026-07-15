import { onRequestGet as handle } from "../core/api/public-config.js";
import { runtimeEnv } from "../_runtime-env.js";

export default function onRequest(context) {
  if (context.request.method !== "GET") {
    return new Response(JSON.stringify({ ok: false, message: "请求方法不允许。" }), {
      status: 405,
      headers: { "Content-Type": "application/json; charset=utf-8", Allow: "GET" }
    });
  }
  return handle({ ...context, env: runtimeEnv });
}
