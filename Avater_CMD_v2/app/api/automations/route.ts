import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const avatarId = searchParams.get("avatarId");

    const where: any = {};
    if (avatarId) where.avatarId = avatarId;

    const automations = await prisma.automation.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        avatar: { select: { name: true } }
      }
    });

    return NextResponse.json(automations);
  } catch (error: any) {
    console.error("Error fetching automations:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { name, description, avatarId, trigger, action, config } = body;

    if (!name || !avatarId || !trigger || !action) {
      return NextResponse.json(
        { error: "name, avatarId, trigger, and action are required" },
        { status: 400 }
      );
    }

    const item = await prisma.automation.create({
      data: {
        name,
        description,
        avatarId,
        trigger,
        action,
        config: config ? JSON.stringify(config) : "{}",
        status: "ACTIVE",
      },
    });

    return NextResponse.json(item);
  } catch (error: any) {
    console.error("Error creating automation:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
