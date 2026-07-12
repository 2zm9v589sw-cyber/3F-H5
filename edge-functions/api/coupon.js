import { onRequestGet, onRequestPost } from "../../functions/api/coupon.js";

export default function onRequest(context) {
  return context.request.method === "GET" ? onRequestGet(context) : onRequestPost(context);
}
