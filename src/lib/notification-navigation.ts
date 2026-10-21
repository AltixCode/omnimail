export type NotificationTarget =
  | {
      type: "email";
      messageId: string;
      accountId?: string;
      folderId?: string;
    }
  | {
      type: "calendar";
      eventId: string;
      startDate?: string;
    };

function nonEmpty(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

export function buildNotificationUrl(
  target: NotificationTarget,
  currentUrl: string,
): string {
  const url = new URL(currentUrl);
  url.search = "";
  url.hash = "";

  if (target.type === "email") {
    url.pathname = `/mail/message/${encodeURIComponent(target.messageId.trim())}`;
    if (nonEmpty(target.accountId)) {
      url.searchParams.set("accountId", target.accountId!.trim());
    }
    if (nonEmpty(target.folderId)) {
      url.searchParams.set("folderId", target.folderId!.trim());
    }
  } else {
    url.pathname = `/calendar/event/${encodeURIComponent(target.eventId.trim())}`;
    if (nonEmpty(target.startDate)) {
      url.searchParams.set("startDate", target.startDate!.trim());
    }
  }

  return url.toString();
}

export function parseNotificationTarget(
  searchOrUrl: string | URLSearchParams,
): NotificationTarget | null {
  let pathname = "";
  let params: URLSearchParams;

  if (typeof searchOrUrl === "string") {
    if (searchOrUrl.includes("://") || searchOrUrl.startsWith("http")) {
      try {
        const u = new URL(searchOrUrl);
        pathname = u.pathname;
        params = u.searchParams;
      } catch {
        params = new URLSearchParams(searchOrUrl);
      }
    } else if (searchOrUrl.startsWith("/")) {
      const qIndex = searchOrUrl.indexOf("?");
      if (qIndex !== -1) {
        pathname = searchOrUrl.slice(0, qIndex);
        params = new URLSearchParams(searchOrUrl.slice(qIndex));
      } else {
        pathname = searchOrUrl;
        params = new URLSearchParams();
      }
    } else {
      params = new URLSearchParams(searchOrUrl);
    }
  } else {
    params = searchOrUrl;
  }

  // Check path-based URLs
  if (pathname) {
    const cleanPath = pathname.replace(/^\/+|\/+$/g, "");
    const segments = cleanPath ? cleanPath.split("/").map((s) => decodeURIComponent(s)) : [];

    if (
      (segments[0] === "mail" && segments[1] === "message" && segments[2]) ||
      (segments[0] === "message" && segments[1])
    ) {
      const messageId = segments[0] === "mail" ? segments[2] : segments[1];
      return {
        type: "email",
        messageId,
        ...(nonEmpty(params.get("accountId"))
          ? { accountId: nonEmpty(params.get("accountId")) }
          : {}),
        ...(nonEmpty(params.get("folderId"))
          ? { folderId: nonEmpty(params.get("folderId")) }
          : {}),
      };
    }

    if (segments[0] === "calendar" && segments[1] === "event" && segments[2]) {
      const eventId = segments[2];
      const startDate = nonEmpty(params.get("startDate") || params.get("date"));
      return {
        type: "calendar",
        eventId,
        ...(startDate ? { startDate } : {}),
      };
    }
  }

  // Check query parameters
  const type = params.get("notification");

  if (type === "email") {
    const messageId = nonEmpty(params.get("messageId"));
    if (!messageId) return null;
    return {
      type,
      messageId,
      ...(nonEmpty(params.get("accountId"))
        ? { accountId: nonEmpty(params.get("accountId")) }
        : {}),
      ...(nonEmpty(params.get("folderId"))
        ? { folderId: nonEmpty(params.get("folderId")) }
        : {}),
    };
  }

  if (type === "calendar") {
    const eventId = nonEmpty(params.get("eventId"));
    if (!eventId) return null;
    const startDate = nonEmpty(params.get("startDate") || params.get("date"));
    return {
      type,
      eventId,
      ...(startDate ? { startDate } : {}),
    };
  }

  // Check direct query without ?notification=...
  const directMsgId = nonEmpty(params.get("messageId"));
  if (directMsgId) {
    return {
      type: "email",
      messageId: directMsgId,
      ...(nonEmpty(params.get("accountId"))
        ? { accountId: nonEmpty(params.get("accountId")) }
        : {}),
      ...(nonEmpty(params.get("folderId"))
        ? { folderId: nonEmpty(params.get("folderId")) }
        : {}),
    };
  }

  const directEventId = nonEmpty(params.get("eventId"));
  if (directEventId) {
    const startDate = nonEmpty(params.get("startDate") || params.get("date"));
    return {
      type: "calendar",
      eventId: directEventId,
      ...(startDate ? { startDate } : {}),
    };
  }

  return null;
}

export function shouldOpenCalendarNotification(
  initialEventId: string | null | undefined,
  consumedEventId: string | null,
): boolean {
  return Boolean(initialEventId && initialEventId !== consumedEventId);
}
