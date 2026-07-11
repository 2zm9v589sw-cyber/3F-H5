import { NextRequest, NextResponse } from "next/server";
import { addDays, today } from "@/lib/date";
import { makeCouponCode } from "@/lib/codes";
import { eq, insertRows, selectRows } from "@/lib/supabase";
import type { ActivitySetting, Coupon, CouponType, Merchant, ThresholdRule } from "@/lib/types";

export const dynamic = "force-dynamic";

type IssueBody = {
  merchantId: string;
  couponTypeId: string;
  categoryKey: string;
  orderAmount: number;
};

export async function POST(req: NextRequest) {
  const body = (await req.json()) as IssueBody;
  const amount = Number(body.orderAmount || 0);
  if (!body.merchantId || !body.couponTypeId || !body.categoryKey) {
    return NextResponse.json({ ok: false, message: "请完整选择商户、券类型和消费类别。" }, { status: 400 });
  }

  const [settings, merchants, couponTypes, thresholds, existing] = await Promise.all([
    selectRows<ActivitySetting>("activity_settings", { select: "*", id: eq("main") }),
    selectRows<Merchant>("merchants", { select: "*", id: eq(body.merchantId), active: eq("true") }),
    selectRows<CouponType>("coupon_types", { select: "*", id: eq(body.couponTypeId), active: eq("true") }),
    selectRows<ThresholdRule>("threshold_rules", { select: "*", category_key: eq(body.categoryKey), active: eq("true") }),
    selectRows<Coupon>("coupons", { select: "id", order: "issued_at.desc" })
  ]);

  const setting = settings[0];
  const merchant = merchants[0];
  const couponType = couponTypes[0];
  const threshold = thresholds[0];

  if (!setting) return NextResponse.json({ ok: false, message: "活动基础配置缺失。" }, { status: 500 });
  if (!merchant || !merchant.can_issue) return NextResponse.json({ ok: false, message: "该商户未启用发券权限。" }, { status: 403 });
  if (!couponType) return NextResponse.json({ ok: false, message: "券类型不可用。" }, { status: 400 });
  if (!threshold) return NextResponse.json({ ok: false, message: "消费类别未配置赠券门槛。" }, { status: 400 });
  if (amount < Number(threshold.min_amount)) {
    return NextResponse.json({ ok: false, message: `${threshold.category_name}需消费满${threshold.min_amount}元方可赠券。` }, { status: 400 });
  }

  const start = today();
  const end = addDays(start, Math.max(0, Number(setting.default_valid_days || 0)));
  const seq = existing.length + 1;
  const row = {
    code: makeCouponCode(couponType.code, seq),
    coupon_type_id: couponType.id,
    coupon_type_code: couponType.code,
    coupon_type_name: couponType.name,
    source_merchant_id: merchant.id,
    source_label: `${merchant.shop_code}｜${merchant.name}`,
    benefit_text: setting.benefit_text,
    start_date: start,
    end_date: end,
    status: "unused",
    issued_amount: amount,
    issued_category_key: body.categoryKey
  };

  const coupons = await insertRows<Coupon>("coupons", [row]);
  return NextResponse.json({ ok: true, coupon: coupons[0] });
}
