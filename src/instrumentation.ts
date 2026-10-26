export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    try {
      const { scheduledEmailWorker } = await import("@/server/scheduled-worker");
      scheduledEmailWorker.start();
    } catch (err) {
      console.warn("Failed to auto-start scheduled email worker:", err);
    }
  }
}
