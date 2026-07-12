import { onRequestGet as handle } from "../../functions/api/public-config.js";

export default function onRequest(context) {
  return handle(context);
}
