import { onRequestPost } from "../../functions/api/merchant-auth.js";

export default function onRequest(context) {
  return onRequestPost({ ...context, env: process.env });
}
