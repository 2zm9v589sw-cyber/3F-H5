import { onRequestPost as handle } from "../../functions/api/merchant-auth.js";

export default function onRequest(context) {
  return handle(context);
}
