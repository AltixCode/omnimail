import { NextRequest } from "next/server";
import eventBus, { StreamEvent } from "@/server/event-bus";
import imapWorkerPool from "@/server/imap-worker";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  // Start background IDLE listeners if they are not already started
  imapWorkerPool.startAllActive().catch((err) => {
    console.error("Error auto-starting active IMAP idle workers:", err);
  });

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      // Send initial connected event
      const initMessage = `data: ${JSON.stringify({
        type: "connected",
        data: { message: "OmniMail Real-time Stream Connected" },
        timestamp: new Date().toISOString(),
      })}\n\n`;
      controller.enqueue(encoder.encode(initMessage));

      const onStreamEvent = (event: StreamEvent) => {
        try {
          const chunk = `data: ${JSON.stringify(event)}\n\n`;
          controller.enqueue(encoder.encode(chunk));
        } catch (err) {
          console.error("Error pushing SSE event:", err);
        }
      };

      eventBus.on("stream-event", onStreamEvent);

      // Heartbeat every 15 seconds to keep connection alive
      const heartbeatInterval = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: heartbeat\n\n`));
        } catch {
          clearInterval(heartbeatInterval);
        }
      }, 15000);

      req.signal.addEventListener("abort", () => {
        clearInterval(heartbeatInterval);
        eventBus.off("stream-event", onStreamEvent);
        try {
          controller.close();
        } catch {}
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // Disable buffering in Nginx / Traefik
    },
  });
}
