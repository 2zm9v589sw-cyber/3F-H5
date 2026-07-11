"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import type { Coupon } from "@/lib/types";

function statusLabel(status: string) {
  return status === "used" ? "已使用" : status === "expired" ? "已过期" : "未使用";
}

export function CouponCard({ coupon, baseUrl }: { coupon: Coupon & { computedStatus?: string }; baseUrl?: string }) {
  const [qr, setQr] = useState("");
  const status = coupon.computedStatus || coupon.status;
  const origin = baseUrl || (typeof location !== "undefined" ? location.origin : "");

  useEffect(() => {
    const url = `${origin}/redeem?code=${encodeURIComponent(coupon.code)}`;
    QRCode.toDataURL(url, { width: 260, margin: 1 }).then(setQr);
  }, [coupon.code, origin]);

  return (
    <div className="coupon-preview">
      <div className={`coupon-head ${coupon.coupon_type_code === "repurchase" ? "repurchase" : ""}`}>
        <div className="muted" style={{ color: "rgba(255,255,255,.82)" }}>西宁城北吾悦广场暑期3楼特别活动</div>
        <div className="title">{coupon.coupon_type_name}</div>
        <div>{coupon.source_label} 发放</div>
      </div>
      <div className="coupon-body">
        <div className="muted" style={{ textAlign: "center" }}>券码</div>
        <div className="code">{coupon.code}</div>
        <div style={{ textAlign: "center" }}><span className={`badge ${status}`}>{statusLabel(status)}</span></div>
        {qr ? <img className="qr" src={qr} alt="商户核销二维码" /> : <div className="qr" />}
        <div className="muted" style={{ textAlign: "center" }}>有效期：{coupon.start_date} 至 {coupon.end_date}</div>
        <div className="alert ok">{coupon.benefit_text}</div>
        <div className="alert">请长按保存券面或直接截图保存。使用时向商户出示本二维码，商户扫码核销。</div>
      </div>
    </div>
  );
}
