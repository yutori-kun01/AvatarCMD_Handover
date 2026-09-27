import { NextResponse } from "next/server";
import { checkPassword, setPassword } from "@/lib/auth";
import { route } from "@/lib/api";

export const runtime = "nodejs";

export const POST = route(async (req: Request) => {
  const { current, next } = (await req.json()) as { current: string; next: string };
  if (!(await checkPassword(current ?? ""))) return NextResponse.json({ error: "現在のパスワードが違います" }, { status: 400 });
  await setPassword(next ?? "");
  return NextResponse.json({ ok: true });
});
