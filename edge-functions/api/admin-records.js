import { onRequestPost as handle } from "../../functions/api/admin-records.js";

export default function onRequest(context) {
  return handle(context);
}
