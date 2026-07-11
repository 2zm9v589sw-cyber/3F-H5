function normalizeBody(body) {
  if (body == null) return null;
  return typeof body === "string" ? body : JSON.stringify(body);
}

function applyResult(res, result) {
  Object.entries(result.headers || {}).forEach(([name, value]) => res.setHeader(name, value));
  res.status(result.statusCode || 200).send(result.body || "");
}

exports.runNetlifyHandler = async function runNetlifyHandler(handler, req, res) {
  const result = await handler({
    httpMethod: req.method,
    headers: req.headers,
    body: normalizeBody(req.body),
    queryStringParameters: req.query || {}
  });
  applyResult(res, result);
};
