import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function DELETE(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const item = await prisma.knowledgeItem.delete({
      where: { id: params.id },
    });
    return NextResponse.json(item);
  } catch (error: any) {
    console.error("Error deleting knowledge:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
