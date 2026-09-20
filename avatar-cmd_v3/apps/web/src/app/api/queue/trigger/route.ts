// ================================================
// /api/queue/trigger — ジョブ投入とキュー状態の確認
// ================================================

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@avatar-cmd/db";
import {
  orchestrator,
  authorizeJob,
  JobAccessError,
  type JobType,
} from "@avatar-cmd/core";
import { handleApiError, requireUser, requireWriteUser } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

const JOB_TYPES: JobType[] = [
  "generate_post",
  "publish_post",
  "fetch_knowledge",
  "system_maintenance",
];

// POST /api/queue/trigger — ジョブを投入する
export async function POST(request: NextRequest) {
  try {
    const user = await requireWriteUser();
    const body = await request.json();
    const { type, payload } = body ?? {};

    if (!type || !payload || typeof payload !== "object") {
      return NextResponse.json(
        { error: "type と payload は必須です" },
        { status: 400 },
      );
    }
    if (!JOB_TYPES.includes(type)) {
      return NextResponse.json(
        { error: `type は ${JOB_TYPES.join(" / ")} のいずれかです` },
        { status: 400 },
      );
    }

    const authorized = await authorizeJob(user.id, type, payload);
    const jobId = await orchestrator.addJob(type, authorized);

    return NextResponse.json({
      success: true,
      jobId,
      message: "ジョブをキューに追加しました",
    });
  } catch (error) {
    if (error instanceof JobAccessError)
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    return handleApiError("ジョブの投入", error);
  }
}

// GET /api/queue/trigger — キューの状態を返す
export async function GET() {
  try {
    await requireUser();
    return NextResponse.json(await orchestrator.getQueueStatus());
  } catch (error) {
    return handleApiError("キュー状態の取得", error);
  }
}
