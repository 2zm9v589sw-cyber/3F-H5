import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { statusOf } from "@/lib/date";
import { eq, patchRows, selectRows, upsertRows } from "@/lib/supabase";
import type { ActivitySetting, Coupon, CouponType, Merchant, ThresholdRule } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireAdmin();
    const [settings, merchants, couponTypes, thresholdRules, coupons] = await Promise.all([
      selectRows<ActivitySetting>("activity_settings", { select: "*", id: eq("main") }),
      selectRows<Merchant>("merchants", { select: "*", order: "sort_order.asc,name.asc" }),
      selectRows<CouponType>("coupon_types", { select: "*", order: "sort_order.asc" }),
      selectRows<ThresholdRule>("threshold_rules", { select: "*", order: "sort_order.asc" }),
      selectRows<Coupon>("coupons", { select: "*", order: "issued_at.desc" })
    ]);
    return NextResponse.json({ ok: true, setting: settings[0], merchants, couponTypes, thresholdRules, coupons: coupons.map((c) => ({ ...c, computedStatus: statusOf(c) })) });
  } catch (err) {
    return NextResponse.json({ ok: false, message: err instanceof Error ? err.message : "无权限。" }, { status: 401 });
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    const body = await req.json();
    const setting = body.setting as ActivitySetting;
    const merchants = body.merchants as Merchant[];
    const couponTypes = body.couponTypes as CouponType[];
    const thresholdRules = body.thresholdRules as ThresholdRule[];

    await patchRows<ActivitySetting>("activity_settings", { id: eq("main") }, {
      activity_name: setting.activity_name,
      benefit_text: setting.benefit_text,
      default_valid_days: Number(setting.default_valid_days || 0),
      starts_on: setting.starts_on || null,
      ends_on: setting.ends_on || null
    });

    const [currentMerchants, currentCouponTypes, currentThresholdRules] = await Promise.all([
      selectRows<Merchant>("merchants", { select: "id" }),
      selectRows<CouponType>("coupon_types", { select: "id" }),
      selectRows<ThresholdRule>("threshold_rules", { select: "id" })
    ]);
    const keepMerchants = new Set(merchants.map((m) => m.id));
    const keepCouponTypes = new Set(couponTypes.map((t) => t.id));
    const keepThresholds = new Set(thresholdRules.map((r) => r.id));
    await Promise.all([
      ...currentMerchants.filter((m) => !keepMerchants.has(m.id)).map((m) => patchRows("merchants", { id: eq(m.id) }, { active: false })),
      ...currentCouponTypes.filter((t) => !keepCouponTypes.has(t.id)).map((t) => patchRows("coupon_types", { id: eq(t.id) }, { active: false })),
      ...currentThresholdRules.filter((r) => !keepThresholds.has(r.id)).map((r) => patchRows("threshold_rules", { id: eq(r.id) }, { active: false }))
    ]);

    if (merchants.length) {
      await upsertRows<Merchant>("merchants", merchants.map((m, idx) => ({
        ...m,
        sort_order: Number(m.sort_order ?? idx),
        active: Boolean(m.active),
        can_issue: Boolean(m.can_issue),
        can_redeem: Boolean(m.can_redeem),
        is_guide_point: Boolean(m.is_guide_point)
      })));
    }
    if (couponTypes.length) {
      await upsertRows<CouponType>("coupon_types", couponTypes.map((t, idx) => ({
        ...t,
        sort_order: Number(t.sort_order ?? idx),
        active: Boolean(t.active)
      })));
    }
    if (thresholdRules.length) {
      await upsertRows<ThresholdRule>("threshold_rules", thresholdRules.map((r, idx) => ({
        ...r,
        min_amount: Number(r.min_amount || 0),
        sort_order: Number(r.sort_order ?? idx),
        active: Boolean(r.active)
      })));
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ ok: false, message: err instanceof Error ? err.message : "保存失败。" }, { status: 400 });
  }
}
