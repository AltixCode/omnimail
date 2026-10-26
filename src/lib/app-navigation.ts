export type MailView =
  | "inbox"
  | "starred"
  | "sent"
  | "scheduled"
  | "archive"
  | "spam"
  | "trash"
  | "folder";

export type CalendarViewMode = "month" | "week" | "day" | "agenda";

export type FilterMode = "all" | "unread" | "starred" | "attachments";

export interface AppRoute {
  tab: "mail" | "calendar";
  mailView?: MailView;
  folderId?: string | null;
  messageId?: string | null;
  calendarViewMode?: CalendarViewMode;
  calendarEventId?: string | null;
  calendarDate?: Date | null;
  accountId?: string | null;
  filterMode?: FilterMode;
  searchQuery?: string;
}

function cleanParam(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Normalizes calendar view mode aliases (e.g. weekly -> week, monthly -> month)
 */
export function normalizeCalendarViewMode(
  val: string | null | undefined,
): CalendarViewMode | undefined {
  if (!val) return undefined;
  const lower = val.toLowerCase().trim();
  if (lower === "week" || lower === "weekly") return "week";
  if (lower === "month" || lower === "monthly") return "month";
  if (lower === "day" || lower === "daily") return "day";
  if (lower === "agenda") return "agenda";
  return undefined;
}

/**
 * Parses pathname and search parameters into a structured AppRoute.
 */
export function parseAppUrl(
  pathnameOrUrl: string,
  search?: string | URLSearchParams,
): AppRoute {
  let pathname = pathnameOrUrl;
  let params: URLSearchParams;

  if (pathnameOrUrl.includes("://") || pathnameOrUrl.startsWith("http")) {
    try {
      const parsedUrl = new URL(pathnameOrUrl);
      pathname = parsedUrl.pathname;
      params = parsedUrl.searchParams;
    } catch {
      params =
        typeof search === "string"
          ? new URLSearchParams(search)
          : search || new URLSearchParams();
    }
  } else {
    const qIndex = pathname.indexOf("?");
    if (qIndex !== -1) {
      params = new URLSearchParams(pathname.slice(qIndex));
      pathname = pathname.slice(0, qIndex);
    } else {
      params =
        typeof search === "string"
          ? new URLSearchParams(search)
          : search || new URLSearchParams();
    }
  }

  // Remove leading/trailing slashes and split
  const cleanPath = pathname.replace(/^\/+|\/+$/g, "");
  const segments = cleanPath ? cleanPath.split("/").map((s) => decodeURIComponent(s)) : [];

  const accountId = cleanParam(params.get("account") || params.get("accountId")) || null;
  const filterParam = cleanParam(params.get("filter"));
  const filterMode: FilterMode =
    filterParam === "unread" ||
    filterParam === "starred" ||
    filterParam === "attachments"
      ? filterParam
      : "all";
  const searchQuery = cleanParam(params.get("q") || params.get("search")) || "";

  // 1. Check legacy notification query params first
  const notifType = params.get("notification");
  if (notifType === "email") {
    const msgId = cleanParam(params.get("messageId"));
    if (msgId) {
      return {
        tab: "mail",
        mailView: "inbox",
        messageId: msgId,
        accountId: accountId || cleanParam(params.get("accountId")) || null,
        folderId: cleanParam(params.get("folderId")) || null,
        filterMode,
        searchQuery,
      };
    }
  } else if (notifType === "calendar") {
    const eventId = cleanParam(params.get("eventId"));
    if (eventId) {
      const sDateStr = cleanParam(params.get("startDate"));
      const sDate = sDateStr ? new Date(sDateStr) : null;
      return {
        tab: "calendar",
        calendarEventId: eventId,
        calendarDate: sDate && !isNaN(sDate.getTime()) ? sDate : null,
        calendarViewMode: "month",
      };
    }
  }

  // 2. Calendar Routes
  if (segments[0] === "calendar") {
    const sub = segments[1];

    if (sub === "event" && segments[2]) {
      const eventId = segments[2];
      const dateStr = cleanParam(params.get("date") || params.get("startDate"));
      const dateObj = dateStr ? new Date(dateStr) : null;
      return {
        tab: "calendar",
        calendarEventId: eventId,
        calendarDate: dateObj && !isNaN(dateObj.getTime()) ? dateObj : null,
        calendarViewMode: normalizeCalendarViewMode(params.get("view")) || "month",
        accountId,
      };
    }

    const mode = normalizeCalendarViewMode(sub);
    const dateStr = cleanParam(params.get("date") || params.get("startDate"));
    const dateObj = dateStr ? new Date(dateStr) : null;
    const eventId = cleanParam(params.get("event") || params.get("eventId")) || null;

    return {
      tab: "calendar",
      calendarViewMode: mode || "month",
      calendarEventId: eventId,
      calendarDate: dateObj && !isNaN(dateObj.getTime()) ? dateObj : null,
      accountId,
    };
  }

  // 3. Direct Message Link: /message/:id
  if (segments[0] === "message" && segments[1]) {
    return {
      tab: "mail",
      mailView: "inbox",
      messageId: segments[1],
      accountId,
      filterMode,
      searchQuery,
    };
  }

  // 4. Mail Routes
  let viewSegment = segments[0] === "mail" ? segments[1] : segments[0];
  let idSegment = segments[0] === "mail" ? segments[2] : segments[1];

  // If URL is /mail/message/:id
  if (segments[0] === "mail" && segments[1] === "message" && segments[2]) {
    return {
      tab: "mail",
      mailView: "inbox",
      messageId: segments[2],
      accountId,
      filterMode,
      searchQuery,
    };
  }

  // If URL is /mail/folder/:folderId
  if ((segments[0] === "mail" && segments[1] === "folder" && segments[2]) ||
      (segments[0] === "folder" && segments[1])) {
    const fId = segments[0] === "mail" ? segments[2] : segments[1];
    const mId = segments[0] === "mail" ? segments[3] : segments[2];
    return {
      tab: "mail",
      mailView: "folder",
      folderId: fId,
      messageId: mId || null,
      accountId,
      filterMode,
      searchQuery,
    };
  }

  // Standard Mail Views: inbox, starred, sent, scheduled, archive, spam, trash
  const validViews: Record<string, MailView> = {
    inbox: "inbox",
    starred: "starred",
    sent: "sent",
    scheduled: "scheduled",
    outbox: "scheduled",
    archive: "archive",
    spam: "spam",
    junk: "spam",
    trash: "trash",
    bin: "trash",
  };

  if (viewSegment && validViews[viewSegment.toLowerCase()]) {
    const view = validViews[viewSegment.toLowerCase()];
    return {
      tab: "mail",
      mailView: view,
      messageId: idSegment || null,
      accountId,
      filterMode,
      searchQuery,
    };
  }

  // Search Route: /mail/search or ?q=...
  if (viewSegment === "search") {
    return {
      tab: "mail",
      mailView: "inbox",
      searchQuery: idSegment || searchQuery,
      accountId,
      filterMode,
    };
  }

  // Default: Mail Inbox
  return {
    tab: "mail",
    mailView: "inbox",
    accountId,
    filterMode,
    searchQuery,
  };
}

/**
 * Builds the canonical path and URL for an AppRoute.
 */
export function buildAppUrl(route: AppRoute, baseUrl?: string): string {
  const url = new URL(baseUrl || "https://webmail.altixcode.com");
  url.search = "";
  url.hash = "";

  if (route.tab === "calendar") {
    if (route.calendarEventId) {
      url.pathname = `/calendar/event/${encodeURIComponent(route.calendarEventId)}`;
    } else {
      const mode = route.calendarViewMode || "month";
      url.pathname = `/calendar/${mode}`;
    }

    if (route.calendarDate && !isNaN(route.calendarDate.getTime())) {
      url.searchParams.set("date", route.calendarDate.toISOString().slice(0, 10));
    }
  } else {
    // Mail tab
    if (route.messageId) {
      url.pathname = `/mail/message/${encodeURIComponent(route.messageId)}`;
    } else if (route.mailView === "folder" && route.folderId) {
      url.pathname = `/mail/folder/${encodeURIComponent(route.folderId)}`;
    } else {
      url.pathname = `/mail/${route.mailView || "inbox"}`;
    }

    if (route.searchQuery?.trim()) {
      url.searchParams.set("q", route.searchQuery.trim());
    }

    if (route.filterMode && route.filterMode !== "all") {
      url.searchParams.set("filter", route.filterMode);
    }
  }

  if (route.accountId) {
    url.searchParams.set("account", route.accountId);
  }

  // If baseUrl was provided, return absolute URL; otherwise return relative path + query
  if (baseUrl) {
    return url.toString();
  }
  return `${url.pathname}${url.search}`;
}
