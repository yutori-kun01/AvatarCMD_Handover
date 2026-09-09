import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const body = await request.json();
    const { status } = body;

    const item = await prisma.automation.update({
      where: { id: params.id },
      data: { status },
    });
    return NextResponse.json(item);
  } catch (error: any) {
    console.error("Error updating automation:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const item = await prisma.automation.delete({
      where: { id: params.id },
    });
    return NextResponse.json(item);
  } catch (error: any) {
    console.error("Error deleting automation:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
