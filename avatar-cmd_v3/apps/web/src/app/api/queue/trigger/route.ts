import { z } from "zod"
import { orchestrator, JOB_TYPES } from "@avatar-cmd/core"
import { route, parseBody } from "@/lib/api"

export const dynamic = "force-dynamic"

const schema = z.object({
  type: z.enum(JOB_TYPES as [string, ...string[]]),
  payload: z
    .object({
      avatarId: z.string().optional(),
      automationId: z.string().optional(),
      contentId: z.string().optional(),
      data: z.record(z.unknown()).optional(),
    })
    .default({}),
})

// POST /api/queue/trigger — enqueue a job (e.g. generate_post)
export const POST = route(async (req) => {
  const { type, payload } = await parseBody(req, schema)
  const jobId = await orchestrator.addJob(type as (typeof JOB_TYPES)[number], payload)
  return { success: true, jobId, message: "Job has been added to the queue", queueStatus: await orchestrator.getQueueStatus() }
})

// GET /api/queue/trigger — queue status
export const GET = route(async () => orchestrator.getQueueStatus())
