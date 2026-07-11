import { NextRequest, NextResponse } from "next/server";
import { createAdminToken, setAdminCookie } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const password = String(body.password || "");
  if (!process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ ok: false, message: "后台密码未配置。" }, { status: 500 });
  }
  if (password !== process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ ok: false, message: "后台密码错误。" }, { status: 401 });
  }
  await setAdminCookie(createAdminToken());
  return NextResponse.json({ ok: true });
}
