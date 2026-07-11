import { NextRequest, NextResponse } from "next/server";
import { nowText, statusOf } from "@/lib/date";
import { eq, patchRows, selectRows } from "@/lib/supabase";
import type { Coupon, CouponType, Merchant } from "@/lib/types";

export const dynamic = "force-dynamic";

type RedeemBody = {
  code: string;
  redeemMerchantId: string;
  amount: number;
  phoneLast4?: string;
  note?: string;
};

export async function POST(req: NextRequest) {
  const body = (await req.json()) as RedeemBody;
  const code = (body.code || "").trim().toUpperCase();
  if (!code || !body.redeemMerchantId) {
    return NextResponse.json({ ok: false, message: "缺少券码或核销点位。" }, { status: 400 });
  }

  const [coupons, merchants] = await Promise.all([
    selectRows<Coupon>("coupons", { select: "*", code: eq(code) }),
    selectRows<Merchant>("merchants", { select: "*", id: eq(body.redeemMerchantId), active: eq("true") })
  ]);
  const coupon = coupons[0];
  const merchant = merchants[0];
  if (!coupon) return NextResponse.json({ ok: false, message: "未找到该券码，不能核销。" }, { status: 404 });
  if (!merchant || !merchant.can_redeem) return NextResponse.json({ ok: false, message: "该点位未启用核销权限。" }, { status: 403 });

  const current = statusOf(coupon);
  if (current !== "unused") {
    return NextResponse.json({ ok: false, message: "该券已使用或已过期，不能核销。", coupon }, { status: 400 });
  }

  const couponTypes = await selectRows<CouponType>("coupon_types", { select: "*", id: eq(coupon.coupon_type_id) });
  const couponType = couponTypes[0];
  if (!couponType) return NextResponse.json({ ok: false, message: "券类型配置缺失。" }, { status: 500 });

  if (couponType.redeem_scope === "guide_points" && !merchant.is_guide_point) {
    return NextResponse.json({ ok: false, message: "亲子畅玩引导卡只能在已配置的亲子多经点位核销。" }, { status: 400 });
  }
  if (couponType.redeem_scope === "regular_merchants" && merchant.is_guide_point) {
    return NextResponse.json({ ok: false, message: "品牌复购引导券不能在亲子多经点位核销，请选择正铺或主次力店。" }, { status: 400 });
  }

  const updated = await patchRows<Coupon>("coupons", { code: eq(code) }, {
    status: "used",
    redeem_merchant_id: merchant.id,
    redeem_point_label: `${merchant.shop_code}｜${merchant.name}`,
    redeem_amount: Number(body.amount || 0),
    phone_last4: body.phoneLast4 || "",
    note: body.note || "",
    redeemed_at: nowText()
  });
  return NextResponse.json({ ok: true, coupon: updated[0] });
}
