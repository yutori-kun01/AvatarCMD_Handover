// X API の単価と為替（全アバター共通。予算・見積もりの円換算に使う）
import { NextResponse } from "next/server";
import { getXPricing, saveXPricing } from "@avatar-cmd/integrations/server";
import { route } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = route(async () => NextResponse.json({ pricing: await getXPricing() }));
export const PUT = route(async (req: Request) => NextResponse.json({ pricing: await saveXPricing(await req.json()) }));
