import { NextResponse } from "next/server";
import { ensureDefaultAvatar, overview } from "@avatar-cmd/integrations/server";
import { route } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(async () => {
  await ensureDefaultAvatar();
  return NextResponse.json(await overview());
});
