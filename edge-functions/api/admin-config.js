import { onRequestPost as handle } from "../../functions/api/admin-config.js";

export default function onRequest(context) {
  return handle(context);
}
