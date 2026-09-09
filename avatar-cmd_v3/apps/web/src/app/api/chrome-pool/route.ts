// ================================================
// Avatar CMD — Chrome Empire API Route
// ================================================
// GET: Returns pool status for dashboard display

import { NextResponse } from "next/server";

// Since Chrome Empire pool runs as a separate process (worker),
// this endpoint returns mock data for the dashboard.
// In production, this will communicate with the worker via Redis/BullMQ.

export async function GET() {
  // TODO: Connect to actual Chrome Empire pool via Redis pub/sub
  const poolStatus = {
    totalInstances: 2,
    activeInstances: 1,
    idleInstances: 1,
    errorInstances: 0,
    totalMemoryMB: 384,
    maxInstances: 5,
    instances: [
      {
        id: "inst-haru-001",
        avatarId: "1",
        avatarName: "Haru",
        status: "running",
        metrics: {
          memoryMB: 210,
          activePages: 2,
          tasksCompleted: 47,
          tasksErrored: 1,
          uptime: 7245,
        },
      },
      {
        id: "inst-kai-002",
        avatarId: "2",
        avatarName: "Kai",
        status: "idle",
        metrics: {
          memoryMB: 174,
          activePages: 0,
          tasksCompleted: 32,
          tasksErrored: 0,
          uptime: 5120,
        },
      },
    ],
  };

  return NextResponse.json(poolStatus);
}
