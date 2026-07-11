import { onRequestPost } from "../../functions/api/admin-config.js";

export default function onRequest(context) {
  return onRequestPost({ ...context, env: process.env });
}
