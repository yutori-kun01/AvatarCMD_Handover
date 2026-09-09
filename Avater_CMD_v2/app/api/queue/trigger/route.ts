import { NextResponse } from "next/server";
import { orchestrator, JobType, JobPayload } from "@/lib/queue/orchestrator";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { type, payload } = body as { type: JobType; payload: JobPayload };

    if (!type || !payload) {
      return NextResponse.json(
        { error: "type and payload are required" },
        { status: 400 }
      );
    }

    const jobId = await orchestrator.addJob(type, payload);

    return NextResponse.json({
      success: true,
      jobId,
      message: "Job has been added to the queue",
      queueStatus: orchestrator.getQueueStatus(),
    });
  } catch (error: any) {
    console.error("Failed to enqueue job:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function GET() {
  // キューの状態を取得する簡単なデバッグ用エンドポイント
  return NextResponse.json(orchestrator.getQueueStatus());
}
