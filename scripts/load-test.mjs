const SITE_URL = process.env.SITE_URL || "https://kaleidoscopic-tartufo-942ff4.netlify.app";
const SUPABASE_URL = process.env.SUPABASE_URL || "https://xpohldtsdttqklqkkskk.supabase.co";
const PUBLIC_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || "sb_publishable_Gk05pu6uyKQ6kZvQwJk_aw_5C8oguZ3";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

const COUNT = Number(process.env.TEST_COUNT || process.argv.find((arg) => arg.startsWith("--count="))?.split("=")[1] || 20);
const CONCURRENCY = Number(process.env.TEST_CONCURRENCY || process.argv.find((arg) => arg.startsWith("--concurrency="))?.split("=")[1] || 8);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

async function timed(label, fn) {
  const start = performance.now();
  const result = await fn();
  return { label, ms: Math.round(performance.now() - start), result };
}

async function rpc(name, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: PUBLIC_KEY,
      Authorization: `Bearer ${PUBLIC_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  if (!res.ok) throw new Error(text || `RPC ${name} failed: ${res.status}`);
  return text ? JSON.parse(text) : null;
}

async function pool(items, worker, concurrency) {
  const results = [];
  let index = 0;
  async function run() {
    while (index < items.length) {
      const current = index++;
      try {
        results[current] = await worker(items[current], current);
      } catch (err) {
        results[current] = { ok: false, error: err.message || String(err) };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
  return results;
}

async function loadConfig() {
  const res = await fetch(`${SITE_URL}/.netlify/functions/public-config?ts=${Date.now()}`, { cache: "no-store" });
  const json = await res.json();
  if (!res.ok || !json.ok) throw new Error(json.message || "public-config failed");
  return json.data;
}

function pick(list, idx) {
  return list[idx % list.length];
}

async function issueCoupon(plan) {
  return timed("issue", async () => {
    const result = await rpc("public_issue_coupon", {
      p_coupon_type_code: plan.type.code,
      p_source_merchant_id: plan.source.id,
      p_category_key: plan.threshold.category_key,
      p_order_amount: Number(plan.threshold.min_amount) + 100
    });
    return result;
  });
}

async function checkCoupon(code) {
  return timed("check", () => rpc("public_get_coupon", { p_code: code }));
}

async function redeemCoupon(coupon, redeemMerchant) {
  return timed("redeem", () => rpc("public_redeem_coupon", {
    p_code: coupon.code,
    p_redeem_merchant_id: redeemMerchant.id,
    p_redeem_amount: 19.9,
    p_phone_last4: "0000",
    p_note: `AUTO_LOAD_TEST_${new Date().toISOString()}`
  }));
}

async function cleanup(codes) {
  if (!SERVICE_KEY || !codes.length) return { skipped: true, deleted: 0 };
  let deleted = 0;
  for (let i = 0; i < codes.length; i += 50) {
    const chunk = codes.slice(i, i + 50);
    const filter = `in.(${chunk.join(",")})`;
    const res = await fetch(`${SUPABASE_URL}/rest/v1/coupons?code=${encodeURIComponent(filter)}`, {
      method: "DELETE",
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        Prefer: "return=representation"
      }
    });
    const text = await res.text();
    if (!res.ok) throw new Error(text || `cleanup failed: ${res.status}`);
    deleted += text ? JSON.parse(text).length : 0;
    await sleep(100);
  }
  return { skipped: false, deleted };
}

function summarize(label, timedResults) {
  const ok = timedResults.filter((item) => item?.result?.ok);
  const failed = timedResults.length - ok.length;
  const times = timedResults.filter((item) => item?.ms != null).map((item) => item.ms);
  return {
    label,
    total: timedResults.length,
    ok: ok.length,
    failed,
    avg_ms: Math.round(times.reduce((sum, ms) => sum + ms, 0) / Math.max(1, times.length)),
    p50_ms: percentile(times, 50),
    p90_ms: percentile(times, 90),
    max_ms: Math.max(0, ...times)
  };
}

async function main() {
  const overallStart = performance.now();
  const configTimed = await timed("config", loadConfig);
  const config = configTimed.result;

  const issueMerchants = config.merchants.filter((m) => m.active !== false && m.can_issue);
  const guideRedeem = config.merchants.filter((m) => m.active !== false && m.can_redeem && m.is_guide_point);
  const regularRedeem = config.merchants.filter((m) => m.active !== false && m.can_redeem && !m.is_guide_point);
  const couponTypes = config.couponTypes.filter((t) => t.active !== false);
  const thresholds = config.thresholdRules.filter((t) => t.active !== false);

  if (!issueMerchants.length || !guideRedeem.length || !regularRedeem.length || !couponTypes.length || !thresholds.length) {
    throw new Error("配置不完整，无法压测：需要可发券商户、亲子多经核销点、正铺核销点、券类型和满额条件。");
  }

  const plans = Array.from({ length: COUNT }, (_, idx) => {
    const source = pick(issueMerchants, idx);
    const type = pick(couponTypes, idx);
    const threshold = thresholds.find((t) => t.category_key === source.category_key) || pick(thresholds, idx);
    return { source, type, threshold };
  });

  const issueResults = await pool(plans, issueCoupon, CONCURRENCY);
  const issuedCoupons = issueResults
    .filter((item) => item?.result?.ok && item.result.coupon?.code)
    .map((item) => item.result.coupon);

  const checkResults = await pool(issuedCoupons, (coupon) => checkCoupon(coupon.code), CONCURRENCY);

  const redeemResults = await pool(issuedCoupons, (coupon, idx) => {
    const type = couponTypes.find((item) => item.code === coupon.coupon_type_code);
    const redeemMerchant = type?.redeem_scope === "guide_points" ? pick(guideRedeem, idx) : pick(regularRedeem, idx);
    return redeemCoupon(coupon, redeemMerchant);
  }, CONCURRENCY);

  const cleanupResult = await cleanup(issuedCoupons.map((coupon) => coupon.code));

  const report = {
    site: SITE_URL,
    count: COUNT,
    concurrency: CONCURRENCY,
    config_ms: configTimed.ms,
    issue: summarize("issue", issueResults),
    check: summarize("check", checkResults),
    redeem: summarize("redeem", redeemResults),
    cleanup: cleanupResult,
    total_ms: Math.round(performance.now() - overallStart)
  };

  console.log(JSON.stringify(report, null, 2));

  if (report.issue.failed || report.check.failed || report.redeem.failed) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
