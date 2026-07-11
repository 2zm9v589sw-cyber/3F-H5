import { NextRequest, NextResponse } from "next/server";
import { eq, selectRows } from "@/lib/supabase";
import { statusOf } from "@/lib/date";
import type { Coupon } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const code = (req.nextUrl.searchParams.get("code") || "").trim().toUpperCase();
  if (!code) return NextResponse.json({ ok: false, message: "缺少券码。" }, { status: 400 });

  const rows = await selectRows<Coupon>("coupons", { select: "*", code: eq(code) });
  const coupon = rows[0];
  if (!coupon) return NextResponse.json({ ok: false, message: "未找到该券码。" }, { status: 404 });

  return NextResponse.json({ ok: true, coupon: { ...coupon, computedStatus: statusOf(coupon) } });
}
