import { onRequestPost as handle } from "../../functions/api/admin-export.js";

export default function onRequest(context) {
  return handle(context);
}
