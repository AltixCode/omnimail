import { EventEmitter } from "events";

export interface StreamEvent {
  type:
    | "new-message"
    | "message-updated"
    | "message-deleted"
    | "sync-status"
    | "folder-updated"
    | "calendar-updated"
    | "heartbeat";
  data: any;
  timestamp: string;
}

class MailEventBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(200);
  }

  broadcast(type: StreamEvent["type"], data: any) {
    const payload: StreamEvent = {
      type,
      data,
      timestamp: new Date().toISOString(),
    };
    this.emit("stream-event", payload);
  }
}

const globalForEventBus = globalThis as unknown as {
  mailEventBus: MailEventBus | undefined;
};

export const eventBus = globalForEventBus.mailEventBus ?? new MailEventBus();

if (process.env.NODE_ENV !== "production") {
  globalForEventBus.mailEventBus = eventBus;
}

export default eventBus;
