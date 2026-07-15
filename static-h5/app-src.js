import QRCode from "qrcode";
import jsQR from "jsqr";

const root = document.getElementById("root");

let bootstrap = null;
let lastCoupon = null;
let stream = null;
let scanFrame = null;
let adminData = null;
let adminPassword = sessionStorage.getItem("cb3fAdminPassword") || "";
let merchantToken = localStorage.getItem("cb3fMerchantToken") || "";
let merchantProfile = null;
try { merchantProfile = JSON.parse(localStorage.getItem("cb3fMerchantProfile") || "null"); } catch {}
let merchantExpiresAt = Number(localStorage.getItem("cb3fMerchantExpiresAt") || 0);
let merchantAuthed = Boolean(merchantToken && merchantProfile?.id && merchantExpiresAt > Date.now());
if (!merchantAuthed) {
  merchantToken = "";
  merchantProfile = null;
  merchantExpiresAt = 0;
  localStorage.removeItem("cb3fMerchantToken");
  localStorage.removeItem("cb3fMerchantProfile");
  localStorage.removeItem("cb3fMerchantExpiresAt");
}
const receiptPhotos = { issue: null, redeem: null };
const adminFilters = { keyword: "", status: "all", type: "all" };

const params = () => new URLSearchParams(location.search);
const role = () => params().get("role") || (params().get("code") ? "coupon" : "home");
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (s) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[s]));
const money = (v) => Number(v || 0).toFixed(2).replace(/\.00$/, "");
const sumMoney = (rows, key) => rows.reduce((sum, row) => sum + Number(row[key] || 0), 0);
const proofTypeLabel = (value) => value === "paper" ? "纸质小票" : value === "screen" ? "电脑/平板订单" : "历史凭证";
const activityText = (merchant) => merchant?.activity_content?.trim() || "该品牌活动内容待后台维护。";
const hasActivityContent = (merchant) => Boolean(merchant?.activity_content?.trim());
const isBeverageMerchant = (merchant) => /餐饮|饮品|甜品|茶|咖啡|水吧/.test(`${merchant?.category_name || ""}${merchant?.name || ""}`);
const BOOTSTRAP_CACHE_KEY = "cb3fBootstrapCacheV2";
const BOOTSTRAP_CACHE_MS = 30 * 1000;
const LEGACY_TEST_COUPON_CODES = new Set(["REP-0708-261876", "GUI-0708-138044"]);
const isTestCoupon = (coupon) => String(coupon.note_text || coupon.note || "").startsWith("AUTO_LOAD_TEST") || LEGACY_TEST_COUPON_CODES.has(coupon.code);

async function couponApi(action, data = {}, authenticated = true) {
  const res = await fetch("/api/coupon", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(authenticated && merchantToken ? { Authorization: `Bearer ${merchantToken}` } : {})
    },
    body: JSON.stringify({ action, ...data })
  });
  const json = await res.json();
  if (!res.ok || !json.ok) {
    if (res.status === 401) clearMerchantSession();
    throw new Error(json.message || "券操作失败。");
  }
  return json;
}

function clearMerchantSession() {
  merchantToken = "";
  merchantProfile = null;
  merchantAuthed = false;
  merchantExpiresAt = 0;
  localStorage.removeItem("cb3fMerchantToken");
  localStorage.removeItem("cb3fMerchantProfile");
  localStorage.removeItem("cb3fMerchantExpiresAt");
}

async function qrImageUrl(value) {
  const svg = await QRCode.toString(value, { type: "svg", width: 280, margin: 1, errorCorrectionLevel: "M" });
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

async function loadBootstrap() {
  if (bootstrap) return bootstrap;
  if (role() !== "admin") {
    try {
      const cached = JSON.parse(localStorage.getItem(BOOTSTRAP_CACHE_KEY) || "null");
      if (cached?.savedAt && Date.now() - cached.savedAt < BOOTSTRAP_CACHE_MS && cached.data) {
        bootstrap = cached.data;
        return bootstrap;
      }
    } catch {}
  }
  const res = await fetch("/api/public-config", { cache: role() === "admin" ? "no-store" : "default" });
  const json = await res.json();
  if (!res.ok || !json.ok) throw new Error(json.message || "读取活动配置失败");
  bootstrap = json.data;
  if (role() !== "admin") {
    try {
      localStorage.setItem(BOOTSTRAP_CACHE_KEY, JSON.stringify({ savedAt: Date.now(), data: bootstrap }));
    } catch {}
  }
  return bootstrap;
}

function roleLinks() {
  const current = role();
  if (current === "admin") return `<a href="?role=home">首页</a>`;
  if (current === "merchant") return `<a href="?role=redeem">商户核销</a>`;
  if (current === "redeem") return `<a href="?role=merchant">商户发券</a>`;
  if (current === "home") return `<a href="?role=merchant">商户发券</a><a href="?role=redeem">商户核销</a>`;
  return "";
}

function layout(title, subtitle, body) {
  const setting = bootstrap?.setting;
  root.classList.toggle("admin-app", role() === "admin");
  root.innerHTML = `
    <div class="topbar">
      <div>
        <h1>${esc(setting?.activity_name || "西宁城北吾悦广场暑期3楼特别活动")}</h1>
        <p class="muted">${esc(subtitle || title)}</p>
      </div>
      <div class="nav">
        ${roleLinks()}
      </div>
    </div>
    ${body}
  `;
}

function setMsg(text, type = "") {
  const el = document.getElementById("msg");
  if (el) el.className = `alert ${type}`, el.textContent = text;
}

function couponTypeActivityHtml(data, couponTypeCode) {
  const type = data.couponTypes.find((item) => item.code === couponTypeCode);
  let merchants = data.merchants.filter((merchant) => merchant.active !== false && merchant.can_redeem && hasActivityContent(merchant));
  if (type?.redeem_scope === "guide_points") merchants = merchants.filter((merchant) => merchant.is_guide_point);
  if (type?.redeem_scope === "regular_merchants") merchants = merchants.filter((merchant) => !merchant.is_guide_point);
  if (type?.name?.includes("饮品")) merchants = merchants.filter(isBeverageMerchant);
  if (type?.code === "repurchase" || type?.name?.includes("复购")) merchants = merchants.filter((merchant) => !isBeverageMerchant(merchant));

  if (!type) return "请先选择券类型。";
  if (!merchants.length) return `${esc(type.name)} 当前暂无已维护活动内容的参与商户。`;
  return merchants.map((merchant) => `
    <div class="activity-item">
      <div class="activity-head"><strong>${esc(merchant.name)}</strong><span>${esc(merchant.shop_code)}</span></div>
      <p>${esc(merchant.activity_content)}</p>
    </div>
  `).join("");
}

function updateIssueActivityContent(data) {
  const box = document.getElementById("merchantActivityContent");
  const select = document.getElementById("couponType");
  if (!box || !select) return;
  box.innerHTML = couponTypeActivityHtml(data, select.value);
}

function homeBenefitGroupsHtml(data) {
  return data.couponTypes.map((type) => `
    <div class="home-benefit-group">
      <div class="home-benefit-head">
        <div class="home-benefit-title">${esc(type.name)}</div>
        <div class="home-benefit-hint">横向滑动查看</div>
      </div>
      <div class="home-benefit-list">${couponTypeActivityHtml(data, type.code)}</div>
    </div>
  `).join("");
}

async function merchantAuthCall(merchantId, password) {
  const res = await fetch("/api/merchant-auth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ merchantId, password })
  });
  const json = await res.json();
  if (!res.ok || !json.ok) throw new Error(json.message || "商户口令校验失败");
  return json;
}

function renderMerchantLogin(nextTitle, nextRender) {
  const merchants = (bootstrap?.merchants || []).filter((m) => m.active !== false && (m.can_issue || m.can_redeem));
  layout(nextTitle, "选择本店并输入独立商户口令", `
    <section class="panel">
      <div class="section-title"><h2>商户登录</h2><span class="muted">仅参与活动商户使用</span></div>
      <div class="grid">
        <div class="col-6"><label>商户/铺位号</label><select id="merchantLoginId">${merchants.map((m) => `<option value="${esc(m.id)}">${esc(m.shop_code)}｜${esc(m.name)}</option>`).join("")}</select></div>
        <div class="col-6"><label>6位数字商户口令</label><input id="merchantPassword" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="6" placeholder="输入本店6位数字口令" /></div>
        <div class="col-4" style="align-self:end"><button id="merchantLoginBtn" class="primary">进入</button></div>
      </div>
      <div id="msg" class="alert" style="display:none"></div>
    </section>
  `);
  document.getElementById("merchantLoginBtn").onclick = async () => {
    document.getElementById("msg").style.display = "block";
    try {
      const auth = await merchantAuthCall(document.getElementById("merchantLoginId").value, document.getElementById("merchantPassword").value);
      merchantToken = auth.token;
      merchantProfile = { ...auth.merchant, ...(bootstrap.merchants.find((m) => m.id === auth.merchant.id) || {}) };
      merchantExpiresAt = Number(auth.expiresAt || 0);
      merchantAuthed = true;
      localStorage.setItem("cb3fMerchantToken", merchantToken);
      localStorage.setItem("cb3fMerchantProfile", JSON.stringify(merchantProfile));
      localStorage.setItem("cb3fMerchantExpiresAt", String(merchantExpiresAt));
      await nextRender();
    } catch (err) {
      setMsg(err.message, "bad");
    }
  };
}

async function prepareReceipt(file) {
  if (!file?.type?.startsWith("image/")) throw new Error("请拍摄或选择消费凭证照片。");
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  const hashCanvas = document.createElement("canvas");
  hashCanvas.width = 9;
  hashCanvas.height = 8;
  const hashCtx = hashCanvas.getContext("2d", { willReadFrequently: true });
  hashCtx.drawImage(canvas, 0, 0, 9, 8);
  const pixels = hashCtx.getImageData(0, 0, 9, 8).data;
  let bits = "";
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      const i = (y * 9 + x) * 4;
      const j = i + 4;
      const left = pixels[i] * 0.299 + pixels[i + 1] * 0.587 + pixels[i + 2] * 0.114;
      const right = pixels[j] * 0.299 + pixels[j + 1] * 0.587 + pixels[j + 2] * 0.114;
      bits += left > right ? "1" : "0";
    }
  }
  let perceptualHash = "";
  for (let i = 0; i < 64; i += 4) perceptualHash += parseInt(bits.slice(i, i + 4), 2).toString(16);
  return { dataUrl: canvas.toDataURL("image/jpeg", 0.76), perceptualHash };
}

function bindReceiptInput(kind) {
  const inputEl = document.getElementById(`${kind}Receipt`);
  const preview = document.getElementById(`${kind}ReceiptPreview`);
  inputEl.onchange = async () => {
    try {
      preview.textContent = "正在处理照片...";
      receiptPhotos[kind] = await prepareReceipt(inputEl.files?.[0]);
      preview.innerHTML = `<img src="${receiptPhotos[kind].dataUrl}" alt="消费凭证照片预览" /><span>消费凭证照片已就绪</span>`;
    } catch (err) {
      receiptPhotos[kind] = null;
      preview.textContent = err.message;
    }
  };
}

async function renderHome() {
  await loadBootstrap();
  const setting = bootstrap?.setting;
  const data = bootstrap;
  root.classList.remove("admin-app");
  root.innerHTML = `
    <main class="home-shell">
      <section class="poster">
        <div class="poster-content">
          <div class="poster-badge">西宁城北吾悦广场 3F 暑期专属</div>
          <h1 class="poster-title">暑期3F<br />品牌权益集合</h1>
          <p class="poster-subtitle">到店消费满足条件即可领取电子券，按券类型享受对应参与商户权益。以下内容来自后台已维护活动，后续商户权益更新后首页自动同步。</p>
          <div class="home-benefit-track">
            ${homeBenefitGroupsHtml(data)}
          </div>
          <p class="poster-note">电子券使用以券面说明、商户核销范围及后台券码状态为准。${esc(setting?.benefit_text || "")}</p>
        </div>
      </section>
      <section class="standalone-pass">
        <div class="section-title"><h2>暑期通玩套餐独立宣传</h2><span class="muted">独立售卖/使用，不参与电子券发券及用券核销</span></div>
        <img src="./assets/standalone-pass-poster.webp?v=20260711-2" alt="亲子一站式通玩套餐宣传图" />
      </section>
      <section class="ops-card">
        <div class="section-title"><h2>商户操作入口</h2><span class="muted">仅活动商户及管理人员使用</span></div>
        <div class="nav">
          <a href="?role=merchant">商户发券</a>
          <a href="?role=redeem">商户核销</a>
          <a href="?role=admin">后台管理</a>
        </div>
      </section>
    </main>
  `;
}

async function renderMerchant() {
  const data = await loadBootstrap();
  if (!merchantAuthed) return renderMerchantLogin("商户发券", renderMerchant);
  if (!merchantProfile?.can_issue) return layout("商户发券", "当前商户没有发券权限", `<section class="panel"><div class="alert bad">${esc(merchantProfile?.shop_code)}｜${esc(merchantProfile?.name)} 未开通发券权限。</div></section>`);
  const types = data.couponTypes;
  const threshold = data.thresholdRules.find((r) => r.category_key === merchantProfile.category_key);
  layout("商户发券", "满足满额条件后生成顾客券二维码", `
    <section class="panel">
      <div class="section-title"><h2>商户发券</h2><span class="muted">券当天有效，逾期自动作废</span></div>
      <div class="grid">
        <div class="col-4">
          <label>券类型</label>
          <select id="couponType">${types.map((t) => `<option value="${esc(t.code)}">${esc(t.name)}</option>`).join("")}</select>
        </div>
        <div class="col-4"><label>消费类别/赠券条件</label><div class="readonly">${esc(threshold?.category_name || merchantProfile.category_name || "已配置类别")}${threshold ? ` 满${money(threshold.min_amount)}元` : ""}</div></div>
        <div class="col-8">
          <label>发券商户/铺位号</label>
          <div class="readonly">${esc(merchantProfile.shop_code)}｜${esc(merchantProfile.name)}</div>
        </div>
        <div class="col-8">
          <label>券面权益说明</label>
          <div class="readonly">${esc(data.setting.benefit_text)}</div>
        </div>
        <div class="col-12">
          <label>当前券类型参与商户活动内容</label>
          <div id="merchantActivityContent" class="readonly activity-list"></div>
        </div>
        <div class="col-12">
          <label>消费凭证类型</label>
          <select id="issueProofType"><option value="screen" selected>电脑/平板订单页面</option><option value="paper">纸质小票</option></select>
          <label class="field-gap">消费凭证照片（必须现场拍摄）</label>
          <input id="issueReceipt" type="file" accept="image/*" capture="environment" />
          <div id="issueReceiptPreview" class="receipt-preview">尚未拍摄消费凭证</div>
          <p class="muted">可拍摄电脑/平板订单详情或纸质小票，仅用于后台核验及防重复，不识别金额。</p>
        </div>
        <div class="col-12 consent-box">
          <label class="consent-check"><input id="receiptConsent" type="checkbox" /> <span>我已向顾客告知并取得同意</span></label>
          <p>告知内容：本活动将收集消费凭证照片（电脑/平板订单页面或纸质小票），仅用于活动资格核验、防止重复领券及后台审计，不识别消费金额。凭证仅限授权管理人员查看，并在活动结束30天后自动删除。请拍摄时尽量遮挡姓名、手机号、支付账号及完整付款码等非必要信息。</p>
        </div>
        <div class="col-12"><button id="issueBtn" class="green">生成顾客券二维码</button></div>
      </div>
      <div id="msg" class="alert" style="display:none"></div>
    </section>
    <section id="result" class="panel" style="display:none"></section>
  `);
  document.getElementById("couponType").onchange = () => updateIssueActivityContent(data);
  updateIssueActivityContent(data);
  bindReceiptInput("issue");
  document.getElementById("issueBtn").onclick = issueCoupon;
}

async function issueCoupon() {
  const btn = document.getElementById("issueBtn");
  btn.disabled = true;
  document.getElementById("msg").style.display = "block";
  setMsg("正在生成...");
  try {
    if (!receiptPhotos.issue) throw new Error("请先现场拍摄消费凭证。");
    if (!document.getElementById("receiptConsent").checked) throw new Error("请先向顾客完成信息收集告知并勾选确认。");
    const result = await couponApi("issue", { couponTypeCode: document.getElementById("couponType").value, receipt: receiptPhotos.issue, receiptConsent: true, proofType: document.getElementById("issueProofType").value });
    lastCoupon = result.coupon;
    const url = `${location.origin}${location.pathname}?code=${encodeURIComponent(lastCoupon.code)}`;
    const qr = await qrImageUrl(url);
    document.getElementById("result").style.display = "block";
    document.getElementById("result").innerHTML = `
      <div class="coupon">
        <div class="coupon-name">${esc(lastCoupon.coupon_type_name)}</div>
        <p class="muted">请顾客扫码打开券面并截图保存</p>
        <img class="qr" src="${qr}" alt="顾客券二维码" />
        <div class="code">${esc(lastCoupon.code)}</div>
        <p class="muted">有效期：${esc(lastCoupon.start_date)} 至 ${esc(lastCoupon.end_date)}</p>
      </div>
    `;
    receiptPhotos.issue = null;
    document.getElementById("issueReceipt").value = "";
    document.getElementById("issueReceiptPreview").textContent = "尚未拍摄消费凭证";
    document.getElementById("receiptConsent").checked = false;
    setMsg("已生成顾客券二维码。", "ok");
  } catch (err) {
    setMsg(err.message, "bad");
  } finally {
    btn.disabled = false;
  }
}

async function renderCoupon() {
  await loadBootstrap();
  const code = params().get("code") || "";
  layout("顾客券面", "请向商户出示此页面核销", `<section class="panel"><div id="couponBox" class="coupon">正在加载...</div></section>`);
  try {
    const response = await fetch(`/api/coupon?code=${encodeURIComponent(code)}`, { cache: "no-store" });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.message || "未找到该券码");
    const c = result.coupon;
    const redeemUrl = `${location.origin}${location.pathname}?role=redeem&code=${encodeURIComponent(c.code)}`;
    const qr = await qrImageUrl(redeemUrl);
    const status = c.computedStatus === "used" ? "已使用" : c.computedStatus === "expired" ? "已过期" : "未使用";
    document.getElementById("couponBox").innerHTML = `
      <div class="coupon-name">${esc(c.coupon_type_name)}</div>
      <p>${esc(c.benefit_text)}</p>
      <img class="qr" src="${qr}" alt="核销二维码" />
      <div class="code">${esc(c.code)}</div>
      <p class="muted">状态：${status}｜有效期：${esc(c.start_date)} 至 ${esc(c.end_date)}</p>
      <p class="muted">长按或截图保存此券；核销以后台券码状态为准。</p>
    `;
  } catch (err) {
    document.getElementById("couponBox").innerHTML = `<div class="alert bad">${esc(err.message)}</div>`;
  }
}

async function renderRedeem() {
  const data = await loadBootstrap();
  if (!merchantAuthed) return renderMerchantLogin("商户核销", renderRedeem);
  if (!merchantProfile?.can_redeem) return layout("商户核销", "当前商户没有核销权限", `<section class="panel"><div class="alert bad">${esc(merchantProfile?.shop_code)}｜${esc(merchantProfile?.name)} 未开通核销权限。</div></section>`);
  layout("商户核销", "扫码顾客券面二维码并拍摄消费凭证后核销", `
    <section class="panel">
      <div class="section-title"><h2>商户核销</h2><button id="scanBtn" class="primary">打开扫码</button></div>
      <video id="video" class="scanner" playsinline muted style="display:none"></video>
      <div class="grid">
        <div class="col-6"><label>券码</label><input id="code" value="${esc(params().get("code") || "")}" placeholder="扫码自动带入，手输备用" /></div>
        <div class="col-6"><label>核销点位</label><div class="readonly">${esc(merchantProfile.shop_code)}｜${esc(merchantProfile.name)}</div></div>
        <div class="col-12"><label>当前核销点位活动内容</label><div class="readonly">${esc(activityText(merchantProfile))}</div></div>
        <div class="col-12"><label>消费凭证类型</label><select id="redeemProofType"><option value="screen" selected>电脑/平板订单页面</option><option value="paper">纸质小票</option></select><label class="field-gap">消费凭证照片（必须现场拍摄）</label><input id="redeemReceipt" type="file" accept="image/*" capture="environment" /><div id="redeemReceiptPreview" class="receipt-preview">尚未拍摄消费凭证</div><p class="muted">可拍摄电脑/平板订单详情或纸质小票，仅用于后台核验及防重复，不识别金额。</p></div>
        <div class="col-12"><button id="checkBtn">查询券状态</button> <button id="redeemBtn" class="orange">确认核销</button></div>
      </div>
      <div id="msg" class="alert" style="display:none"></div>
    </section>
    <section id="couponInfo" class="panel" style="display:none"></section>
  `);
  document.getElementById("scanBtn").onclick = startScan;
  document.getElementById("checkBtn").onclick = checkCoupon;
  document.getElementById("redeemBtn").onclick = redeemCoupon;
  bindReceiptInput("redeem");
  if (params().get("code")) await checkCoupon();
}

async function adminCall(action, data) {
  let lastErr = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const res = await fetch("/api/admin-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: adminPassword, action, data })
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.message || "后台请求失败");
      return json.data;
    } catch (err) {
      lastErr = err;
      if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 600));
    }
  }
  throw lastErr;
}

async function renderAdmin() {
  await loadBootstrap();
  layout("后台管理", "修改活动规则、商户点位和核销数据", `
    <section class="panel" id="adminLogin">
      <div class="section-title"><h2>后台登录</h2><span class="muted">仅管理人员使用</span></div>
      <div class="grid">
        <div class="col-6"><label>后台密码</label><input id="adminPassword" type="password" value="${esc(adminPassword)}" placeholder="输入后台密码" /></div>
        <div class="col-6" style="align-self:end"><button id="adminLoginBtn" class="primary">进入后台</button></div>
      </div>
      <div id="msg" class="alert" style="display:none"></div>
    </section>
    <div id="adminBox"></div>
  `);
  document.getElementById("adminLoginBtn").onclick = async () => {
    adminPassword = document.getElementById("adminPassword").value;
    sessionStorage.setItem("cb3fAdminPassword", adminPassword);
    await loadAdmin();
  };
  if (adminPassword) await loadAdmin();
}

async function loadAdmin() {
  document.getElementById("msg").style.display = "block";
  try {
    adminData = await adminCall("get");
    setMsg("后台已加载。", "ok");
    drawAdmin();
  } catch (err) {
    setMsg(err.message, "bad");
  }
}

function input(value, path, type = "text") {
  return `<input data-path="${esc(path)}" type="${type}" value="${esc(value ?? "")}" />`;
}

function selectBool(value, path) {
  return `<select data-path="${esc(path)}"><option value="true" ${value ? "selected" : ""}>是</option><option value="false" ${!value ? "selected" : ""}>否</option></select>`;
}

function bindAdminInputs() {
  document.querySelectorAll("[data-path]").forEach((el) => {
    el.onchange = () => {
      const path = el.dataset.path.split(".");
      let target = adminData;
      while (path.length > 1) target = target[path.shift()];
      let value = el.value;
      if (el.tagName === "SELECT" && (value === "true" || value === "false")) value = value === "true";
      if (el.type === "number") value = Number(value || 0);
      target[path[0]] = value;
    };
  });
}

function drawAdmin() {
  const d = adminData;
  const filteredCoupons = d.coupons.filter((coupon) => {
    const keyword = adminFilters.keyword.trim().toLowerCase();
    const haystack = [
      coupon.code,
      coupon.coupon_type_name,
      coupon.source_label,
      coupon.redeem_point_label,
      coupon.note_text
    ].join(" ").toLowerCase();
    if (keyword && !haystack.includes(keyword)) return false;
    if (adminFilters.status !== "all" && coupon.computedStatus !== adminFilters.status) return false;
    if (adminFilters.type !== "all" && coupon.coupon_type_code !== adminFilters.type) return false;
    return true;
  });
  const issuedCoupons = filteredCoupons;
  const redeemedCoupons = filteredCoupons.filter((coupon) => coupon.computedStatus === "used");
  const metrics = {
    total: d.coupons.length,
    unused: d.coupons.filter((c) => c.computedStatus === "unused").length,
    used: d.coupons.filter((c) => c.computedStatus === "used").length,
    expired: d.coupons.filter((c) => c.computedStatus === "expired").length,
    test: d.coupons.filter(isTestCoupon).length,
    issueReceipts: d.coupons.filter((c) => c.issue_receipt_path).length,
    redeemReceipts: d.coupons.filter((c) => c.redeem_receipt_path).length
  };
  document.getElementById("adminBox").innerHTML = `
    <div class="admin-workspace">
      <section class="admin-hero">
        <div>
          <div class="admin-metrics">
            <div class="metric-card"><span>总券数</span><strong>${metrics.total}</strong></div>
            <div class="metric-card"><span>未使用</span><strong>${metrics.unused}</strong></div>
            <div class="metric-card"><span>已核销</span><strong>${metrics.used}</strong></div>
            <div class="metric-card"><span>已过期/作废</span><strong>${metrics.expired}</strong></div>
            <div class="metric-card"><span>测试券</span><strong>${metrics.test}</strong></div>
            <div class="metric-card"><span>发券凭证</span><strong>${metrics.issueReceipts}</strong></div>
            <div class="metric-card"><span>核销凭证</span><strong>${metrics.redeemReceipts}</strong></div>
          </div>
        </div>
        <div class="admin-actions">
          <button id="saveAdmin" class="green">保存全部配置</button>
          <button id="clearTestCoupons" class="orange">清除测试券</button>
          <button id="clearAllCoupons" class="orange">清空全部券数据</button>
          <button id="exportCsv">导出 CSV</button>
        </div>
      </section>

      <div class="admin-grid">
        <section class="admin-panel">
          <div class="section-title"><h2>活动基础配置</h2></div>
          <div class="grid">
            <div class="col-6"><label>活动名称</label>${input(d.setting.activity_name, "setting.activity_name")}</div>
            <div class="col-3"><label>活动开始日期</label>${input(d.setting.starts_on || "", "setting.starts_on", "date")}</div>
            <div class="col-3"><label>活动结束日期</label>${input(d.setting.ends_on || "", "setting.ends_on", "date")}</div>
            <div class="col-4"><label>默认有效天数</label>${input(d.setting.default_valid_days, "setting.default_valid_days", "number")}</div>
            <div class="col-12"><label>券面权益说明</label><textarea data-path="setting.benefit_text" rows="4">${esc(d.setting.benefit_text)}</textarea></div>
          </div>
        </section>

        <section class="admin-panel compact">
          <div class="section-title"><h2>满额赠券条件</h2><button id="addThreshold">新增条件</button></div>
          <div class="table-wrap"><table><thead><tr><th>类别编码</th><th>类别名称</th><th>满额金额</th><th>启用</th></tr></thead><tbody>
            ${d.thresholdRules.map((r, i) => `<tr><td>${input(r.category_key, `thresholdRules.${i}.category_key`)}</td><td>${input(r.category_name, `thresholdRules.${i}.category_name`)}</td><td>${input(r.min_amount, `thresholdRules.${i}.min_amount`, "number")}</td><td>${selectBool(r.active, `thresholdRules.${i}.active`)}</td></tr>`).join("")}
          </tbody></table></div>
        </section>

        <section class="admin-panel compact">
          <div class="section-title"><h2>券类型</h2><button id="addCouponType">新增券类型</button></div>
          <div class="table-wrap"><table><thead><tr><th>编码</th><th>名称</th><th>核销范围</th><th>启用</th></tr></thead><tbody>
            ${d.couponTypes.map((t, i) => `<tr><td>${input(t.code, `couponTypes.${i}.code`)}</td><td>${input(t.name, `couponTypes.${i}.name`)}</td><td><select data-path="couponTypes.${i}.redeem_scope"><option value="guide_points" ${t.redeem_scope === "guide_points" ? "selected" : ""}>仅亲子多经点位</option><option value="regular_merchants" ${t.redeem_scope === "regular_merchants" ? "selected" : ""}>正铺/主次力店</option></select></td><td>${selectBool(t.active, `couponTypes.${i}.active`)}</td></tr>`).join("")}
          </tbody></table></div>
        </section>
      </div>

      <section class="admin-panel merchants admin-full">
        <div class="section-title"><h2>商户/点位配置</h2><button id="addMerchant">新增商户</button></div>
        <div class="table-wrap"><table><thead><tr><th>铺位号</th><th>商户名称</th><th>独立口令</th><th>活动内容</th><th>类别</th><th>亲子多经</th><th>可发券</th><th>可核销</th><th>启用</th><th>操作</th></tr></thead><tbody>
          ${d.merchants.map((m, i) => `<tr><td>${input(m.shop_code, `merchants.${i}.shop_code`)}</td><td>${input(m.name, `merchants.${i}.name`)}</td><td><div class="readonly code">${esc(m.access_code || "保存后生成")}</div></td><td><textarea data-path="merchants.${i}.activity_content" rows="2">${esc(m.activity_content || "")}</textarea></td><td><select class="merchantCategory" data-path="merchants.${i}.category_key" data-index="${i}">${d.thresholdRules.map((r) => `<option value="${esc(r.category_key)}" ${r.category_key === m.category_key ? "selected" : ""}>${esc(r.category_name)}</option>`).join("")}</select></td><td>${selectBool(m.is_guide_point, `merchants.${i}.is_guide_point`)}</td><td>${selectBool(m.can_issue, `merchants.${i}.can_issue`)}</td><td>${selectBool(m.can_redeem, `merchants.${i}.can_redeem`)}</td><td>${selectBool(m.active, `merchants.${i}.active`)}</td><td><button class="deleteMerchantBtn orange" data-id="${esc(m.id)}" data-label="${esc(`${m.shop_code}｜${m.name}`)}">删除</button></td></tr>`).join("")}
        </tbody></table></div>
      </section>

      <section class="admin-panel coupons admin-full">
        <div class="section-title"><h2>数据筛选</h2><span class="muted">下方发券数据与核销数据共用此筛选条件</span></div>
        <div class="grid">
          <div class="col-6"><label>搜索券码/商户/备注</label><input id="couponKeyword" value="${esc(adminFilters.keyword)}" placeholder="输入关键词" /></div>
          <div class="col-3"><label>状态</label><select id="couponStatusFilter"><option value="all">全部</option><option value="unused" ${adminFilters.status === "unused" ? "selected" : ""}>未使用</option><option value="used" ${adminFilters.status === "used" ? "selected" : ""}>已核销</option><option value="expired" ${adminFilters.status === "expired" ? "selected" : ""}>已过期/已作废</option></select></div>
          <div class="col-3"><label>券类型</label><select id="couponTypeFilter"><option value="all">全部</option>${d.couponTypes.map((t) => `<option value="${esc(t.code)}" ${adminFilters.type === t.code ? "selected" : ""}>${esc(t.name)}</option>`).join("")}</select></div>
        </div>
      </section>

      <div class="admin-data-grid">
        <section class="admin-panel coupons">
          <div class="section-title"><h2>商户发券记录</h2><span class="muted">${issuedCoupons.length} 张｜凭证 ${issuedCoupons.filter((c) => c.issue_receipt_path).length} 张</span></div>
          <div class="table-wrap"><table><thead><tr><th>券码</th><th>券类型</th><th>发券商户</th><th>消费类别</th><th>发券时间</th><th>凭证类型</th><th>凭证</th><th>状态</th><th>操作</th></tr></thead><tbody>
            ${issuedCoupons.slice(0, 200).map((c) => `<tr><td>${esc(c.code)}</td><td>${esc(c.coupon_type_name)}</td><td>${esc(c.source_label)}</td><td>${esc(c.issued_category_key || "")}</td><td>${esc(c.issued_at || "")}</td><td>${esc(proofTypeLabel(c.issue_proof_type))}</td><td>${c.issue_receipt_path ? `<button class="receiptBtn" data-path="${esc(c.issue_receipt_path)}">查看</button>` : "无"}</td><td>${esc(c.computedStatus)}</td><td>${c.computedStatus === "unused" ? `<button class="voidCouponBtn orange" data-code="${esc(c.code)}">作废</button>` : ""}</td></tr>`).join("")}
          </tbody></table></div>
        </section>

        <section class="admin-panel coupons">
          <div class="section-title"><h2>商户核销记录</h2><span class="muted">${redeemedCoupons.length} 张｜凭证 ${redeemedCoupons.filter((c) => c.redeem_receipt_path).length} 张</span></div>
          <div class="table-wrap"><table><thead><tr><th>券码</th><th>券类型</th><th>发券来源</th><th>核销点位</th><th>核销时间</th><th>凭证类型</th><th>凭证</th><th>备注</th></tr></thead><tbody>
            ${redeemedCoupons.slice(0, 200).map((c) => `<tr><td>${esc(c.code)}</td><td>${esc(c.coupon_type_name)}</td><td>${esc(c.source_label)}</td><td>${esc(c.redeem_point_label || "")}</td><td>${esc(c.redeemed_at || "")}</td><td>${esc(proofTypeLabel(c.redeem_proof_type))}</td><td>${c.redeem_receipt_path ? `<button class="receiptBtn" data-path="${esc(c.redeem_receipt_path)}">查看</button>` : "无"}</td><td>${esc(c.note_text || "")}</td></tr>`).join("")}
          </tbody></table></div>
        </section>
      </div>
    </div>
  `;
  bindAdminInputs();
  document.querySelectorAll(".merchantCategory").forEach((select) => {
    select.onchange = () => {
      const merchant = d.merchants[Number(select.dataset.index)];
      const rule = d.thresholdRules.find((item) => item.category_key === select.value);
      merchant.category_key = select.value;
      merchant.category_name = rule?.category_name || merchant.category_name;
    };
  });
  document.getElementById("saveAdmin").onclick = saveAdmin;
  document.getElementById("addThreshold").onclick = () => { d.thresholdRules.push({ id: crypto.randomUUID(), category_key: "new", category_name: "新类别", min_amount: 0, active: true, sort_order: d.thresholdRules.length }); drawAdmin(); };
  document.getElementById("addCouponType").onclick = () => { d.couponTypes.push({ id: crypto.randomUUID(), code: "new", name: "新券类型", redeem_scope: "regular_merchants", active: true, sort_order: d.couponTypes.length }); drawAdmin(); };
  document.getElementById("addMerchant").onclick = () => { d.merchants.push({ id: crypto.randomUUID(), shop_code: "", name: "新商户", activity_content: "", category_key: "retail_kids", category_name: "儿童零售", is_guide_point: false, can_issue: true, can_redeem: true, active: true, sort_order: d.merchants.length }); drawAdmin(); };
  document.getElementById("clearTestCoupons").onclick = clearTestCoupons;
  document.getElementById("clearAllCoupons").onclick = clearAllCoupons;
  document.getElementById("exportCsv").onclick = exportAdminCsv;
  document.getElementById("couponKeyword").oninput = (event) => { adminFilters.keyword = event.target.value; drawAdmin(); };
  document.getElementById("couponStatusFilter").onchange = (event) => { adminFilters.status = event.target.value; drawAdmin(); };
  document.getElementById("couponTypeFilter").onchange = (event) => { adminFilters.type = event.target.value; drawAdmin(); };
  document.querySelectorAll(".voidCouponBtn").forEach((button) => {
    button.onclick = () => voidCoupon(button.dataset.code);
  });
  document.querySelectorAll(".receiptBtn").forEach((button) => {
    button.onclick = () => viewReceipt(button.dataset.path);
  });
  document.querySelectorAll(".deleteMerchantBtn").forEach((button) => {
    button.onclick = () => deleteMerchant(button.dataset.id, button.dataset.label);
  });
}

async function saveAdmin() {
  try {
    validateAdminData();
    await adminCall("save", configPayload());
    bootstrap = null;
    localStorage.removeItem(BOOTSTRAP_CACHE_KEY);
    setMsg("保存成功，商户端会读取最新规则。", "ok");
    try {
      await loadAdmin();
    } catch (err) {
      setMsg("保存成功，但后台列表刷新失败。请手动刷新页面查看最新数据。", "ok");
    }
  } catch (err) {
    setMsg(err.message, "bad");
  }
}

function configPayload() {
  return {
    setting: adminData.setting,
    merchants: adminData.merchants,
    couponTypes: adminData.couponTypes,
    thresholdRules: adminData.thresholdRules
  };
}

function validateAdminData() {
  const seen = new Set();
  for (const merchant of adminData.merchants) {
    const shop = String(merchant.shop_code || "").trim();
    const name = String(merchant.name || "").trim();
    if (!shop || !name) throw new Error("商户/点位配置中，铺位号和商户名称不能为空。");
    const key = `${shop}||${name}`;
    if (seen.has(key)) throw new Error(`商户重复：${shop}｜${name}。请修改铺位号或商户名称后再保存。`);
    seen.add(key);
  }
}

function exportAdminCsv() {
  const headers = ["券码", "券类型", "发券商户", "发券消费类别", "发券时间", "发券凭证类型", "发券凭证留存", "券状态", "有效期", "核销点位", "核销时间", "核销凭证类型", "核销凭证留存", "备注"];
  const rows = adminData.coupons.map((c) => [c.code, c.coupon_type_name, c.source_label, c.issued_category_key, c.issued_at, proofTypeLabel(c.issue_proof_type), c.issue_receipt_path ? "是" : "否", c.computedStatus, `${c.start_date}至${c.end_date}`, c.redeem_point_label, c.redeemed_at, proofTypeLabel(c.redeem_proof_type), c.redeem_receipt_path ? "是" : "否", c.note_text]);
  const csv = [headers, ...rows].map((row) => row.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" }));
  link.download = "3F电子券核销数据.csv";
  link.click();
  URL.revokeObjectURL(link.href);
}

async function viewReceipt(path) {
  try {
    const result = await adminCall("receiptUrl", { path });
    window.open(result.url, "_blank", "noopener");
  } catch (err) {
    setMsg(err.message, "bad");
  }
}

async function clearTestCoupons() {
  if (!confirm("确认清除后台自动测试产生的测试券吗？正式活动券不会被清除。")) return;
  try {
    const result = await adminCall("clearTestCoupons");
    setMsg(`已清除 ${result.data?.deleted || 0} 张测试券。`, "ok");
    await loadAdmin();
  } catch (err) {
    setMsg(err.message, "bad");
  }
}

async function clearAllCoupons() {
  const first = confirm("确认清空全部券数据吗？这会删除所有已发券、已核销、已过期/作废记录。正式活动开始后请勿使用。");
  if (!first) return;
  const second = prompt("如确认清空，请输入：清空全部券数据");
  if (second !== "清空全部券数据") {
    setMsg("已取消清空全部券数据。", "bad");
    return;
  }
  try {
    const result = await adminCall("clearAllCoupons");
    setMsg(`已清空全部券数据，共删除 ${result.deleted || 0} 张。`, "ok");
    await loadAdmin();
  } catch (err) {
    setMsg(err.message, "bad");
  }
}

async function voidCoupon(code) {
  if (!confirm(`确认作废券码 ${code} 吗？已核销的券不会被作废。`)) return;
  try {
    const result = await adminCall("voidCoupon", { code });
    if (!result.updated) throw new Error("未作废任何券，可能该券已核销或不存在。");
    setMsg(`已作废券码 ${code}。`, "ok");
    await loadAdmin();
  } catch (err) {
    setMsg(err.message, "bad");
  }
}

async function deleteMerchant(id, label) {
  if (!confirm(`确认删除商户/点位 ${label} 吗？如只是暂停活动，建议将“启用”改为否。`)) return;
  try {
    const result = await adminCall("deleteMerchant", { id });
    if (!result.deleted) throw new Error("未删除任何商户，可能该商户已不存在。");
    setMsg(`已删除 ${label}。`, "ok");
    await loadAdmin();
  } catch (err) {
    setMsg(err.message, "bad");
  }
}

async function checkCoupon() {
  document.getElementById("msg").style.display = "block";
  try {
    const result = await couponApi("check", { code: document.getElementById("code").value });
    lastCoupon = result.coupon;
    const status = lastCoupon.computedStatus === "used" ? "已使用" : lastCoupon.computedStatus === "expired" ? "已过期" : "未使用";
    document.getElementById("couponInfo").style.display = "block";
    document.getElementById("couponInfo").innerHTML = `
      <div class="coupon">
        <div class="coupon-name">${esc(lastCoupon.coupon_type_name)}</div>
        <div class="code">${esc(lastCoupon.code)}</div>
        <p>${esc(lastCoupon.benefit_text)}</p>
        <p class="muted">状态：${status}｜来源：${esc(lastCoupon.source_label)}</p>
      </div>
    `;
    setMsg(lastCoupon.computedStatus === "unused" ? "该券有效，可以核销。" : "该券已使用或已过期，不能核销。", lastCoupon.computedStatus === "unused" ? "ok" : "bad");
  } catch (err) {
    setMsg(err.message, "bad");
  }
}

async function redeemCoupon() {
  try {
    if (!receiptPhotos.redeem) throw new Error("请先现场拍摄消费凭证。");
    const result = await couponApi("redeem", { code: document.getElementById("code").value, receipt: receiptPhotos.redeem, proofType: document.getElementById("redeemProofType").value });
    lastCoupon = result.coupon;
    receiptPhotos.redeem = null;
    document.getElementById("redeemReceipt").value = "";
    document.getElementById("redeemReceiptPreview").textContent = "尚未拍摄消费凭证";
    setMsg("核销成功，券码已锁定为已使用。", "ok");
    await checkCoupon();
  } catch (err) {
    setMsg(err.message, "bad");
  }
}

async function startScan() {
  const msg = document.getElementById("msg");
  msg.style.display = "block";
  if (!navigator.mediaDevices?.getUserMedia) {
    setMsg("当前浏览器无法调用摄像头。请使用手机浏览器/微信打开 HTTPS 正式链接，或手输券码。", "bad");
    return;
  }
  setMsg("正在打开摄像头，请在手机弹窗中允许使用摄像头...");
  const video = document.getElementById("video");
  const scanBtn = document.getElementById("scanBtn");
  try {
    stopScan();
    scanBtn.disabled = true;
    video.setAttribute("playsinline", "true");
    video.muted = true;
    video.style.display = "block";
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }
    }).catch(() => navigator.mediaDevices.getUserMedia({ audio: false, video: true }));
    video.srcObject = stream;
    await video.play();
    scanBtn.textContent = "重新打开扫码";
    scanBtn.disabled = false;
    setMsg("摄像头已打开，请将顾客券二维码放入画面中央。", "ok");

    const detector = "BarcodeDetector" in window ? new BarcodeDetector({ formats: ["qr_code"] }) : null;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const resolveCode = async (raw) => {
      if (!raw) return;
      stopScan();
      let code = raw;
      try {
        const url = new URL(raw, location.href);
        code = url.searchParams.get("code") || raw;
      } catch {}
      document.getElementById("code").value = code;
      await checkCoupon();
    };
    const tick = async () => {
      if (!stream) return;
      if (video.readyState >= 2) {
        if (detector) {
          const codes = await detector.detect(video).catch(() => []);
          if (codes.length) return resolveCode(codes[0].rawValue || "");
        } else if (ctx && video.videoWidth && video.videoHeight) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const found = jsQR(image.data, image.width, image.height, { inversionAttempts: "dontInvert" });
          if (found?.data) return resolveCode(found.data);
        }
      }
      scanFrame = requestAnimationFrame(tick);
    };
    tick();
  } catch (err) {
    stopScan();
    scanBtn.disabled = false;
    setMsg("无法打开摄像头。请在微信/浏览器权限里允许摄像头，或用手机相机扫描顾客二维码打开核销链接，也可以手输券码。", "bad");
  }
}

function stopScan() {
  if (scanFrame) cancelAnimationFrame(scanFrame);
  scanFrame = null;
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = null;
  const video = document.getElementById("video");
  if (video) video.style.display = "none";
}

async function main() {
  try {
    if (role() === "merchant") return renderMerchant();
    if (role() === "redeem") return renderRedeem();
    if (role() === "admin") return renderAdmin();
    if (role() === "coupon") return renderCoupon();
    return renderHome();
  } catch (err) {
    root.innerHTML = `<div class="alert bad">${esc(err.message)}</div>`;
  }
}

main();
