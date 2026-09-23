"use client";

import { useEffect, useRef, useState, useCallback } from "react";

export interface StreamPayload {
  type:
    | "connected"
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

interface UseLiveStreamOptions {
  onNewMessage?: (data: any) => void;
  onMessageUpdated?: (data: any) => void;
  onMessageDeleted?: (data: any) => void;
  onFolderUpdated?: (data: any) => void;
  onSyncStatus?: (data: any) => void;
  onCalendarUpdated?: (data: any) => void;
  enableSound?: boolean;
}

// Synthesize a gentle notification chime using Web Audio API
export function playChime() {
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();

    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gainNode = ctx.createGain();

    osc1.type = "sine";
    osc1.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
    osc1.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.15); // A5

    osc2.type = "triangle";
    osc2.frequency.setValueAtTime(880, ctx.currentTime); // A5
    osc2.frequency.exponentialRampToValueAtTime(1174.66, ctx.currentTime + 0.2); // D6

    gainNode.gain.setValueAtTime(0.001, ctx.currentTime);
    gainNode.gain.linearRampToValueAtTime(0.15, ctx.currentTime + 0.05);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.6);

    osc1.connect(gainNode);
    osc2.connect(gainNode);
    gainNode.connect(ctx.destination);

    osc1.start(ctx.currentTime);
    osc2.start(ctx.currentTime + 0.05);
    osc1.stop(ctx.currentTime + 0.6);
    osc2.stop(ctx.currentTime + 0.6);
  } catch (e) {
    // Ignore audio autoplay restrictions
  }
}

export function useLiveStream(options: UseLiveStreamOptions = {}) {
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>("default");
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined" && "Notification" in window) {
      setNotificationPermission(Notification.permission);
    }
  }, []);

  const requestNotificationPermission = useCallback(async () => {
    if (typeof window !== "undefined" && "Notification" in window) {
      try {
        const perm = await Notification.requestPermission();
        setNotificationPermission(perm);
        return perm === "granted";
      } catch (err) {
        console.error("Error requesting notification permission:", err);
      }
    }
    return false;
  }, []);

  const showDesktopNotification = useCallback((message: any, showPreview: boolean = true) => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission !== "granted") return;

    try {
      const title = showPreview
        ? `New email from ${message.fromName || message.fromAddress}`
        : "New email received";
      const body = showPreview
        ? `${message.subject || "No subject"}\n${message.snippet || ""}`.trim()
        : "You have received a new message in OmniMail.";

      const notif = new Notification(title, {
        body,
        icon: "/icon.svg",
        tag: `email-${message.id || Date.now()}`,
      });

      notif.onclick = () => {
        window.focus();
        notif.close();
      };
    } catch (e) {
      console.warn("Could not display notification:", e);
    }
  }, []);

  useEffect(() => {
    let reconnectTimer: NodeJS.Timeout;

    function connect() {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }

      const es = new EventSource("/api/events");
      eventSourceRef.current = es;

      es.onopen = () => {
        setIsConnected(true);
      };

      es.onmessage = (e) => {
        try {
          const payload: StreamPayload = JSON.parse(e.data);

          switch (payload.type) {
            case "connected":
              setIsConnected(true);
              break;

            case "new-message": {
              const soundPref = typeof window !== "undefined" ? localStorage.getItem("omnimail_sound_enabled") !== "false" : true;
              if (options.enableSound !== false && soundPref) {
                playChime();
              }
              const previewPref = typeof window !== "undefined" ? localStorage.getItem("omnimail_preview_enabled") !== "false" : true;
              if (payload.data?.message) {
                showDesktopNotification(payload.data.message, previewPref);
              }
              options.onNewMessage?.(payload.data);
              break;
            }

            case "message-updated":
              options.onMessageUpdated?.(payload.data);
              break;

            case "message-deleted":
              options.onMessageDeleted?.(payload.data);
              break;

            case "folder-updated":
              options.onFolderUpdated?.(payload.data);
              break;

            case "sync-status":
              options.onSyncStatus?.(payload.data);
              break;

            case "calendar-updated":
              options.onCalendarUpdated?.(payload.data);
              break;

            default:
              break;
          }
        } catch (err) {
          // Heartbeat or comment
        }
      };

      es.onerror = () => {
        setIsConnected(false);
        es.close();
        // Exponential / backoff reconnection after 5 seconds
        clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(connect, 5000);
      };
    }

    connect();

    return () => {
      clearTimeout(reconnectTimer);
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, [
    options.onNewMessage,
    options.onMessageUpdated,
    options.onMessageDeleted,
    options.onFolderUpdated,
    options.onSyncStatus,
    options.onCalendarUpdated,
    options.enableSound,
    showDesktopNotification,
  ]);

  return {
    isConnected,
    notificationPermission,
    requestNotificationPermission,
  };
}

export default useLiveStream;
