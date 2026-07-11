"use client";

import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import type { BootstrapData, Coupon } from "@/lib/types";

export default function MerchantPage() {
  const [data, setData] = useState<BootstrapData | null>(null);
  const [merchantId, setMerchantId] = useState("");
  const [couponTypeId, setCouponTypeId] = useState("");
  const [categoryKey, setCategoryKey] = useState("");
  const [orderAmount, setOrderAmount] = useState("");
  const [message, setMessage] = useState("");
  const [coupon, setCoupon] = useState<Coupon | null>(null);
  const [qr, setQr] = useState("");

  useEffect(() => {
    fetch("/api/public/bootstrap").then((r) => r.json()).then((json) => {
      setData(json);
      setMerchantId(json.merchants?.[0]?.id || "");
      setCouponTypeId(json.couponTypes?.[0]?.id || "");
      setCategoryKey(json.thresholdRules?.[0]?.category_key || "");
    }).catch((err) => setMessage(err.message));
  }, []);

  const benefit = data?.setting?.benefit_text || "";
  const threshold = useMemo(() => data?.thresholdRules.find((r) => r.category_key === categoryKey), [data, categoryKey]);

  async function issue() {
    setMessage("");
    setCoupon(null);
    setQr("");
    const res = await fetch("/api/issue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ merchantId, couponTypeId, categoryKey, orderAmount: Number(orderAmount || 0) })
    });
    const json = await res.json();
    if (!res.ok || !json.ok) {
      setMessage(json.message || "生成失败");
      return;
    }
    setCoupon(json.coupon);
    const url = `${location.origin}/coupon?code=${encodeURIComponent(json.coupon.code)}`;
    setQr(await QRCode.toDataURL(url, { width: 260, margin: 1 }));
    setMessage("已生成顾客券二维码，请让顾客扫码保存。");
  }

  return (
    <main className="app">
      <div className="topbar">
        <div className="brand">
          <h1>{data?.setting?.activity_name || "西宁城北吾悦广场暑期3楼特别活动"}</h1>
          <p>商户发券端</p>
        </div>
        <div className="tabs"><a href="/redeem">核销端</a></div>
      </div>

      <section className="panel">
        <div className="section-title">
          <h2>商户发券</h2>
          <span className="muted">满足满额条件后，一位顾客生成一张券。</span>
        </div>
        <div className="grid">
          <div className="col-4">
            <label>发券商户/铺位号</label>
            <select value={merchantId} onChange={(e) => setMerchantId(e.target.value)}>
              {(data?.merchants || []).filter((m) => m.can_issue).map((m) => <option key={m.id} value={m.id}>{m.shop_code}｜{m.name}</option>)}
            </select>
          </div>
          <div className="col-4">
            <label>券类型</label>
            <select value={couponTypeId} onChange={(e) => setCouponTypeId(e.target.value)}>
              {(data?.couponTypes || []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div className="col-4">
            <label>消费类别</label>
            <select value={categoryKey} onChange={(e) => setCategoryKey(e.target.value)}>
              {(data?.thresholdRules || []).map((r) => <option key={r.id} value={r.category_key}>{r.category_name} 满{r.min_amount}元</option>)}
            </select>
          </div>
          <div className="col-4">
            <label>顾客实际消费金额</label>
            <input type="number" min="0" value={orderAmount} onChange={(e) => setOrderAmount(e.target.value)} placeholder={threshold ? `需满${threshold.min_amount}元` : "填写金额"} />
          </div>
          <div className="col-8">
            <label>券面权益说明</label>
            <div className="readonly-box">{benefit}</div>
          </div>
          <div className="col-12">
            <button className="green" onClick={issue}>生成顾客券二维码</button>
          </div>
        </div>
        {message && <div className={`alert ${coupon ? "ok" : "bad"}`}>{message}</div>}
      </section>

      {coupon && (
        <section className="panel" style={{ textAlign: "center" }}>
          <div className="section-title"><h2>给顾客扫描</h2><span className="muted">扫码后顾客保存券面</span></div>
          {qr && <img className="qr" src={qr} alt="顾客券二维码" />}
          <div className="code">{coupon.code}</div>
          <div className="muted">有效期：{coupon.start_date} 至 {coupon.end_date}</div>
        </section>
      )}
    </main>
  );
}
