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

function nonEmpty(value: string | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function buildNotificationUrl(
  target: NotificationTarget,
  currentUrl: string,
): string {
  const url = new URL(currentUrl);
  url.search = "";
  url.hash = "";
  url.searchParams.set("notification", target.type);

  if (target.type === "email") {
    url.searchParams.set("messageId", target.messageId);
    if (target.accountId) url.searchParams.set("accountId", target.accountId);
    if (target.folderId) url.searchParams.set("folderId", target.folderId);
  } else {
    url.searchParams.set("eventId", target.eventId);
    if (target.startDate) url.searchParams.set("startDate", target.startDate);
  }

  return url.toString();
}

export function parseNotificationTarget(
  search: string | URLSearchParams,
): NotificationTarget | null {
  const params =
    typeof search === "string" ? new URLSearchParams(search) : search;
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
    const startDate = nonEmpty(params.get("startDate"));
    return {
      type,
      eventId,
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
