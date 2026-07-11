const MERCHANT_PASSWORD = process.env.MERCHANT_PASSWORD;

const json = (statusCode, body) => ({
  statusCode,
  headers: { "Content-Type": "application/json; charset=utf-8" },
  body: JSON.stringify(body)
});

exports.handler = async (event) => {
  try {
    const body = event.body ? JSON.parse(event.body) : {};
    if (!MERCHANT_PASSWORD) {
      return json(500, { ok: false, message: "商户口令未配置，请联系管理人员。" });
    }
    if (body.password !== MERCHANT_PASSWORD) {
      return json(401, { ok: false, message: "商户口令错误。" });
    }
    return json(200, { ok: true });
  } catch (err) {
    return json(400, { ok: false, message: err.message || "商户口令校验失败。" });
  }
};
