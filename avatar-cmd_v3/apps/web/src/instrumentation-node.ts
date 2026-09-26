// Set RUN_SCHEDULER=false to disable (e.g. when a dedicated worker runs the
// scheduler), or RUN_WORKER=false to only schedule and let another process
// consume the Redis queue.
import { startScheduler, startBrowserResultListener } from "@avatar-cmd/core"

async function boot() {
  if (process.env.NEXT_PHASE === "phase-production-build") return
  if (process.env.RUN_SCHEDULER === "false") {
    console.log("[Instrumentation] Scheduler disabled (RUN_SCHEDULER=false)")
    return
  }
  await startScheduler({ withWorker: process.env.RUN_WORKER !== "false" })
  await startBrowserResultListener()
  console.log("[Instrumentation] Automation daemon started")
}

boot().catch((e) => console.error("[Instrumentation] Failed to start automation daemon:", e))
