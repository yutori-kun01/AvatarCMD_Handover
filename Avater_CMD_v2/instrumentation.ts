export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    console.log("[Instrumentation] Starting orchestrator and cron daemon...");
    const { startCron } = await import("./lib/queue/cron");
    startCron();
  }
}
