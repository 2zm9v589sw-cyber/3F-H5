"use client";

import { useEffect, useState } from "react";
import { CouponCard } from "@/components/CouponCard";
import type { Coupon } from "@/lib/types";

export default function CouponPage() {
  const [coupon, setCoupon] = useState<(Coupon & { computedStatus?: string }) | null>(null);
  const [message, setMessage] = useState("正在加载券面...");

  useEffect(() => {
    const code = new URLSearchParams(location.search).get("code") || "";
    fetch(`/api/coupon?code=${encodeURIComponent(code)}`).then((r) => r.json()).then((json) => {
      if (!json.ok) throw new Error(json.message);
      setCoupon(json.coupon);
      setMessage("");
    }).catch((err) => setMessage(err.message));
  }, []);

  return (
    <main className="app">
      <div className="topbar"><div className="brand"><h1>顾客券面</h1><p>使用时向商户出示本页面二维码</p></div></div>
      {message && <div className="alert bad">{message}</div>}
      {coupon && <CouponCard coupon={coupon} />}
    </main>
  );
}
