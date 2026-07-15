import { createHash, randomBytes } from "node:crypto";

const SITE_URL = (process.env.SITE_URL || "https://xncbwu3f.com").replace(/\/$/, "");
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const COUNT = Math.min(50, Math.max(2, Number(process.env.TEST_COUNT || 6)));
const CONCURRENCY = Math.min(10, Math.max(1, Number(process.env.TEST_CONCURRENCY || 3)));

if (!ADMIN_PASSWORD) throw new Error("请通过 ADMIN_PASSWORD 环境变量提供后台密码后再运行正式接口压测。");

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

async function request(path, options = {}) {
  const started = performance.now();
  let last;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(`${SITE_URL}${path}`, options);
    const text = await response.text();
    let body;
    try { body = JSON.parse(text); } catch { body = { ok: false, message: text }; }
    last = { response, body, ms: Math.round(performance.now() - started), attempts: attempt + 1 };
    const retryable = response.status >= 500 || /CLOUD_FUNCTION_INVOCATION_FAILED|Error return from script/i.test(body?.message || "");
    if (!retryable || attempt === 3) return last;
    await new Promise((resolve) => setTimeout(resolve, 800 * (attempt + 1)));
  }
  return last;
}

async function admin(action, data = {}) {
  const result = await request("/api/admin-config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: ADMIN_PASSWORD, action, data })
  });
  if (!result.response.ok || !result.body.ok) throw new Error(result.body.message || `后台接口失败：${result.response.status}`);
  return result.body.data;
}

async function merchantLogin(merchant) {
  const result = await request("/api/merchant-auth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ merchantId: merchant.id, password: merchant.access_code })
  });
  if (!result.response.ok || !result.body.ok) throw new Error(result.body.message || `商户登录失败：${merchant.name}`);
  return result.body.token;
}

function receipt() {
  const bytes = randomBytes(256);
  const contentHash = createHash("sha256").update(bytes).digest("hex");
  return {
    dataUrl: `data:image/jpeg;base64,${bytes.toString("base64")}`,
    perceptualHash: contentHash.slice(0, 16),
    _auditContentHash: contentHash
  };
}

async function couponAction(token, action, data) {
  return request("/api/coupon", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ action, ...data })
  });
}

async function pool(items, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      try { results[index] = await worker(items[index], index); }
      catch (err) { results[index] = { ok: false, error: err.message }; }
    }
  }));
  return results;
}

function summarize(results) {
  const ok = results.filter((item) => item?.ok);
  const times = results.map((item) => item?.ms).filter(Number.isFinite);
  return {
    total: results.length,
    ok: ok.length,
    failed: results.length - ok.length,
    avg_ms: Math.round(times.reduce((sum, value) => sum + value, 0) / Math.max(1, times.length)),
    p50_ms: percentile(times, 50),
    p90_ms: percentile(times, 90),
    max_ms: Math.max(0, ...times)
  };
}

async function main() {
  const config = await admin("get", { filters: { page: 1, pageSize: 10 } });
  const issuers = config.merchants.filter((merchant) => merchant.active && merchant.can_issue);
  const guides = config.merchants.filter((merchant) => merchant.active && merchant.can_redeem && merchant.is_guide_point);
  const regulars = config.merchants.filter((merchant) => merchant.active && merchant.can_redeem && !merchant.is_guide_point);
  const types = config.couponTypes.filter((type) => type.active);
  if (!issuers.length || !guides.length || !regulars.length || !types.length) throw new Error("活动配置不足，无法执行发券和核销回归测试。");

  const issuer = issuers[0];
  const issuerToken = await merchantLogin(issuer);
  const merchantTokens = new Map();
  async function tokenFor(merchant) {
    if (!merchantTokens.has(merchant.id)) merchantTokens.set(merchant.id, await merchantLogin(merchant));
    return merchantTokens.get(merchant.id);
  }

  const issuedCodes = [];
  const auditReceiptHashes = [];
  let cleanup;
  try {
    const issueResults = await pool(Array.from({ length: COUNT }), async (_, index) => {
      const type = types[index % types.length];
      const proof = receipt();
      auditReceiptHashes.push(proof._auditContentHash);
      const result = await couponAction(issuerToken, "issue", {
        couponTypeCode: type.code,
        receipt: proof,
        receiptConsent: true,
        proofType: "screen"
      });
      if (result.body?.coupon?.code) issuedCodes.push(result.body.coupon.code);
      return { ok: result.response.ok && result.body.ok, ms: result.ms, type, coupon: result.body?.coupon, error: result.body?.message };
    });

    const successful = issueResults.filter((item) => item.ok && item.coupon);
    const checkResults = await pool(successful, async (item) => {
      const result = await request(`/api/coupon?code=${encodeURIComponent(item.coupon.code)}`, { cache: "no-store" });
      return { ok: result.response.ok && result.body.ok && result.body.coupon.computedStatus === "unused", ms: result.ms };
    });

    const redeemResults = await pool(successful, async (item) => {
      const target = item.type.redeem_scope === "guide_points" ? guides[0] : regulars[0];
      const proof = receipt();
      auditReceiptHashes.push(proof._auditContentHash);
      const result = await couponAction(await tokenFor(target), "redeem", { code: item.coupon.code, receipt: proof, proofType: "screen" });
      return { ok: result.response.ok && result.body.ok && result.body.coupon.computedStatus === "used", ms: result.ms, error: result.body?.message };
    });

    cleanup = await admin("cleanupAuditCoupons", { codes: issuedCodes, receiptHashes: auditReceiptHashes });
    const report = {
      site: SITE_URL,
      count: COUNT,
      concurrency: CONCURRENCY,
      issue: summarize(issueResults),
      check: summarize(checkResults),
      redeem: summarize(redeemResults),
      cleanup,
      failureErrors: [...issueResults, ...checkResults, ...redeemResults].filter((item) => !item?.ok).map((item) => item?.error || "未知错误")
    };
    console.log(JSON.stringify(report, null, 2));
    if (report.issue.failed || report.check.failed || report.redeem.failed || cleanup.deleted !== issuedCodes.length) process.exitCode = 1;
  } finally {
    if (!cleanup && (issuedCodes.length || auditReceiptHashes.length)) await admin("cleanupAuditCoupons", { codes: issuedCodes, receiptHashes: auditReceiptHashes }).catch(() => {});
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exitCode = 1;
});
