import { onRequestPost as handle } from "../core/api/admin-config.js";
import { runtimeEnv } from "../_runtime-env.js";

export default function onRequest(context) {
  return handle({ ...context, env: runtimeEnv });
}
