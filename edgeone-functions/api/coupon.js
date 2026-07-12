import { onRequestGet, onRequestPost } from "../core/api/coupon.js";
import { runtimeEnv } from "../_runtime-env.js";

export default function onRequest(context) {
  return context.request.method === "GET"
    ? onRequestGet({ ...context, env: runtimeEnv })
    : onRequestPost({ ...context, env: runtimeEnv });
}
