import { onRequestGet } from "../../functions/api/public-config.js";

export default function onRequest(context) {
  return onRequestGet({ ...context, env: process.env });
}
