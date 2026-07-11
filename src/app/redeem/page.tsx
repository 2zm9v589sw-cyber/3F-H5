"use client";

import { useEffect, useMemo, useState } from "react";
import { CouponCard } from "@/components/CouponCard";
import type { BootstrapData, Coupon } from "@/lib/types";

export default function RedeemPage() {
  const [data, setData] = useState<BootstrapData | null>(null);
  const [code, setCode] = useState("");
  const [coupon, setCoupon] = useState<(Coupon & { computedStatus?: string }) | null>(null);
  const [redeemMerchantId, setRedeemMerchantId] = useState("");
  const [amount, setAmount] = useState("");
  const [phoneLast4, setPhoneLast4] = useState("");
  const [note, setNote] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    fetch("/api/public/bootstrap").then((r) => r.json()).then((json) => setData(json));
    const queryCode = new URLSearchParams(location.search).get("code") || "";
    if (queryCode) {
      setCode(queryCode);
      check(queryCode);
    }
  }, []);

  const redeemMerchants = useMemo(() => {
    const list = (data?.merchants || []).filter((m) => m.can_redeem);
    if (!coupon || !data) return list;
    const type = data.couponTypes.find((t) => t.id === coupon.coupon_type_id);
    if (type?.redeem_scope === "guide_points") return list.filter((m) => m.is_guide_point);
    if (type?.redeem_scope === "regular_merchants") return list.filter((m) => !m.is_guide_point);
    return list;
  }, [data, coupon]);

  useEffect(() => {
    if (redeemMerchants.length && !redeemMerchants.some((m) => m.id === redeemMerchantId)) {
      setRedeemMerchantId(redeemMerchants[0].id);
    }
  }, [redeemMerchants, redeemMerchantId]);

  async function check(value = code) {
    setMessage("");
    const res = await fetch(`/api/coupon?code=${encodeURIComponent(value)}`);
    const json = await res.json();
    if (!res.ok || !json.ok) {
      setCoupon(null);
      setMessage(json.message || "未找到该券码");
      return;
    }
    setCoupon(json.coupon);
    setMessage(json.coupon.computedStatus === "unused" ? "该券有效，可以核销。" : "该券已使用或已过期，不能核销。");
  }

  async function redeem() {
    const res = await fetch("/api/redeem", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, redeemMerchantId, amount: Number(amount || 0), phoneLast4, note })
    });
    const json = await res.json();
    if (!res.ok || !json.ok) {
      setMessage(json.message || "核销失败");
      return;
    }
    setCoupon(json.coupon);
    setMessage("核销成功，券码已锁定为已使用。");
  }

  return (
    <main className="app">
      <div className="topbar"><div className="brand"><h1>{data?.setting?.activity_name || "商户核销端"}</h1><p>扫码后自动带入券码</p></div></div>
      <section className="panel">
        <div className="split">
          <div className="grid">
            <div className="col-6"><label>券码</label><input value={code} onChange={(e) => setCode(e.target.value)} placeholder="扫码后自动带入，手输仅作备用" /></div>
            <div className="col-6"><label>核销点位</label><select value={redeemMerchantId} onChange={(e) => setRedeemMerchantId(e.target.value)}>{redeemMerchants.map((m) => <option key={m.id} value={m.id}>{m.shop_code}｜{m.name}</option>)}</select></div>
            <div className="col-4"><label>核销金额（填写实际消费金额）</label><input type="number" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="如 60" /></div>
            <div className="col-4"><label>顾客手机号后4位</label><input maxLength={4} value={phoneLast4} onChange={(e) => setPhoneLast4(e.target.value)} placeholder="可选" /></div>
            <div className="col-4"><label>备注</label><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="可选" /></div>
            <div className="col-12"><button onClick={() => check()}>查询券状态</button> <button className="orange" onClick={redeem}>确认核销</button></div>
            {message && <div className={`col-12 alert ${message.includes("成功") || message.includes("有效") ? "ok" : "bad"}`}>{message}</div>}
          </div>
          <div>{coupon && <CouponCard coupon={coupon} />}</div>
        </div>
      </section>
    </main>
  );
}
