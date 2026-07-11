import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { selectRows } from "@/lib/supabase";
import { statusOf } from "@/lib/date";
import type { Coupon } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireAdmin();
    const rows = await selectRows<Coupon>("coupons", { select: "*", order: "issued_at.desc" });
    return NextResponse.json({ ok: true, coupons: rows.map((c) => ({ ...c, computedStatus: statusOf(c) })) });
  } catch (err) {
    return NextResponse.json({ ok: false, message: err instanceof Error ? err.message : "无权限。" }, { status: 401 });
  }
}
