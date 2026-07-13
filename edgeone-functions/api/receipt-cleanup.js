import { onRequestPost as handle } from "../core/api/receipt-cleanup.js";
import { runtimeEnv } from "../_runtime-env.js";

export default function onRequest(context) {
  return handle({ ...context, env: runtimeEnv });
}
