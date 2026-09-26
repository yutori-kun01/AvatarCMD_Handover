// Starts the background automation daemon (scheduler + queue worker) inside
// the Next.js server process. The Node-only code lives in instrumentation-node
// so it is excluded from the Edge bundle.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./instrumentation-node")
  }
}
