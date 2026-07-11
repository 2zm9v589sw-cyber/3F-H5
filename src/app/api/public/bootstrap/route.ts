import { NextResponse } from "next/server";
import { eq, selectRows } from "@/lib/supabase";
import type { ActivitySetting, CouponType, Merchant, ThresholdRule } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const [settings, merchants, couponTypes, thresholdRules] = await Promise.all([
    selectRows<ActivitySetting>("activity_settings", { select: "*", id: eq("main") }),
    selectRows<Merchant>("merchants", { select: "*", active: eq("true"), order: "sort_order.asc,name.asc" }),
    selectRows<CouponType>("coupon_types", { select: "*", active: eq("true"), order: "sort_order.asc" }),
    selectRows<ThresholdRule>("threshold_rules", { select: "*", active: eq("true"), order: "sort_order.asc" })
  ]);

  return NextResponse.json({
    ok: true,
    setting: settings[0],
    merchants,
    couponTypes,
    thresholdRules
  });
}
