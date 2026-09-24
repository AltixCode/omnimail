/**
 * Gmail-style Advanced Search Query Parser & Builder
 * 
 * Supports operators:
 * - from:user@example.com or from:name
 * - to:user@example.com
 * - subject:keyword or subject:"multi word phrase"
 * - body:keyword or content:keyword
 * - has:attachment / has:attachments
 * - has:invite / has:calendar
 * - filename:report.pdf or filename:pdf
 * - larger:5M / larger:500k / smaller:1M
 * - after:2026-01-01 / since:2026-01-01
 * - before:2026-12-31 / until:2026-12-31
 * - newer_than:7d / newer_than:1m / newer_than:1y
 * - older_than:7d / older_than:1m
 * - is:unread / is:read / is:starred
 * - in:inbox / in:sent / in:trash / in:archive / in:starred / in:all
 * - -word (exclusion / doesn't have)
 * - "exact phrase"
 * - Free text words (searched across subject, body, snippet, from, to, cc, attachment filenames)
 */

export interface ParsedSearchQuery {
  raw: string;
  from?: string;
  to?: string;
  subject?: string;
  body?: string;
  hasAttachment?: boolean;
  hasInvite?: boolean;
  filename?: string;
  minSize?: number; // in bytes
  maxSize?: number; // in bytes
  afterDate?: Date;
  beforeDate?: Date;
  isRead?: boolean;
  isStarred?: boolean;
  inView?: "inbox" | "sent" | "trash" | "archive" | "starred" | "all";
  freeWords: string[];
  excludeWords: string[];
}

export interface AdvancedSearchFilters {
  from?: string;
  to?: string;
  subject?: string;
  hasWords?: string;
  doesntHave?: string;
  hasAttachment?: boolean;
  hasInvite?: boolean;
  filename?: string;
  sizeRelation?: "greater" | "less" | "";
  sizeValue?: number | string;
  sizeUnit?: "MB" | "KB" | "Bytes";
  dateWithin?: string; // "1d" | "3d" | "7d" | "14d" | "1m" | "6m" | "1y" | "custom" | ""
  dateSent?: string; // ISO date YYYY-MM-DD
  startDate?: string; // ISO date YYYY-MM-DD
  endDate?: string; // ISO date YYYY-MM-DD
  readStatus?: "all" | "unread" | "read";
  starredStatus?: "all" | "starred" | "unstarred";
  inView?: "all" | "inbox" | "starred" | "sent" | "archive" | "trash";
}

/**
 * Parse human readable byte string e.g. "5M", "5MB", "500k", "1024"
 */
export function parseByteSize(str: string): number | null {
  if (!str) return null;
  const match = str.trim().match(/^([0-9.]+)\s*([a-zA-Z]*)$/);
  if (!match) return null;
  const num = parseFloat(match[1]);
  if (isNaN(num)) return null;

  const unit = (match[2] || "").toUpperCase();
  if (unit === "G" || unit === "GB") return Math.round(num * 1024 * 1024 * 1024);
  if (unit === "M" || unit === "MB") return Math.round(num * 1024 * 1024);
  if (unit === "K" || unit === "KB") return Math.round(num * 1024);
  return Math.round(num);
}

/**
 * Format bytes to readable size
 */
export function formatByteSize(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)}MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${bytes}B`;
}

/**
 * Parse relative time string e.g. "7d", "2m", "1y" to milliseconds
 */
function parseRelativeDuration(str: string): number | null {
  const match = str.trim().match(/^(\d+)\s*([dmy])$/i);
  if (!match) return null;
  const count = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  if (unit === "d") return count * 24 * 60 * 60 * 1000;
  if (unit === "m") return count * 30 * 24 * 60 * 60 * 1000;
  if (unit === "y") return count * 365 * 24 * 60 * 60 * 1000;
  return null;
}

/**
 * Parse date string YYYY-MM-DD or YYYY/MM/DD
 */
function parseDateString(str: string, endOfDay = false): Date | null {
  const clean = str.replace(/\//g, "-").trim();
  const d = new Date(clean);
  if (isNaN(d.getTime())) return null;
  if (endOfDay) {
    d.setHours(23, 59, 59, 999);
  } else {
    d.setHours(0, 0, 0, 0);
  }
  return d;
}

/**
 * Tokenize search query preserving quoted phrases and key:value operators
 */
export function tokenizeQuery(query: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let inQuotes = false;
  let quoteChar = "";

  for (let i = 0; i < query.length; i++) {
    const char = query[i];
    if ((char === '"' || char === "'") && (!inQuotes || char === quoteChar)) {
      if (inQuotes) {
        inQuotes = false;
        quoteChar = "";
      } else {
        inQuotes = true;
        quoteChar = char;
      }
      current += char;
    } else if (char === " " && !inQuotes) {
      if (current.trim().length > 0) {
        tokens.push(current.trim());
      }
      current = "";
    } else {
      current += char;
    }
  }

  if (current.trim().length > 0) {
    tokens.push(current.trim());
  }

  return tokens;
}

/**
 * Clean value removing surrounding quotes
 */
function stripQuotes(str: string): string {
  if (
    (str.startsWith('"') && str.endsWith('"')) ||
    (str.startsWith("'") && str.endsWith("'"))
  ) {
    return str.slice(1, -1);
  }
  return str;
}

/**
 * Parses a Gmail-style search query string into structured parameters
 */
export function parseSearchQuery(query: string): ParsedSearchQuery {
  const trimmed = (query || "").trim();
  const parsed: ParsedSearchQuery = {
    raw: trimmed,
    freeWords: [],
    excludeWords: [],
  };

  if (!trimmed) {
    return parsed;
  }

  const tokens = tokenizeQuery(trimmed);

  for (const token of tokens) {
    const colonIdx = token.indexOf(":");
    if (colonIdx > 0 && !token.startsWith("-")) {
      const key = token.slice(0, colonIdx).toLowerCase();
      const val = stripQuotes(token.slice(colonIdx + 1));

      if (key === "from") {
        parsed.from = val;
      } else if (key === "to") {
        parsed.to = val;
      } else if (key === "subject") {
        parsed.subject = val;
      } else if (key === "body" || key === "content") {
        parsed.body = val;
      } else if (key === "has") {
        const lower = val.toLowerCase();
        if (lower === "attachment" || lower === "attachments") {
          parsed.hasAttachment = true;
        } else if (lower === "invite" || lower === "calendar" || lower === "event") {
          parsed.hasInvite = true;
        }
      } else if (key === "filename") {
        parsed.filename = val;
        parsed.hasAttachment = true;
      } else if (key === "larger" || key === "size") {
        const size = parseByteSize(val.replace(/^[>]/, ""));
        if (size !== null) parsed.minSize = size;
      } else if (key === "smaller") {
        const size = parseByteSize(val.replace(/^[<]/, ""));
        if (size !== null) parsed.maxSize = size;
      } else if (key === "after" || key === "since") {
        const d = parseDateString(val, false);
        if (d) parsed.afterDate = d;
      } else if (key === "before" || key === "until") {
        const d = parseDateString(val, true);
        if (d) parsed.beforeDate = d;
      } else if (key === "newer_than") {
        const dur = parseRelativeDuration(val);
        if (dur !== null) {
          parsed.afterDate = new Date(Date.now() - dur);
        }
      } else if (key === "older_than") {
        const dur = parseRelativeDuration(val);
        if (dur !== null) {
          parsed.beforeDate = new Date(Date.now() - dur);
        }
      } else if (key === "is") {
        const lower = val.toLowerCase();
        if (lower === "unread") {
          parsed.isRead = false;
        } else if (lower === "read") {
          parsed.isRead = true;
        } else if (lower === "starred" || lower === "important") {
          parsed.isStarred = true;
        }
      } else if (key === "in") {
        const lower = val.toLowerCase();
        if (["inbox", "sent", "trash", "archive", "starred", "all"].includes(lower)) {
          parsed.inView = lower as ParsedSearchQuery["inView"];
        }
      } else {
        // Unknown key: treat whole token as free word
        parsed.freeWords.push(token);
      }
    } else if (token.startsWith("-") && token.length > 1) {
      // Negative / exclusion word
      const term = stripQuotes(token.slice(1));
      if (term) parsed.excludeWords.push(term);
    } else {
      // Normal free word
      const word = stripQuotes(token);
      if (word) parsed.freeWords.push(word);
    }
  }

  return parsed;
}

/**
 * Builds a search query string from advanced search filters
 */
export function buildSearchQueryString(filters: AdvancedSearchFilters): string {
  const parts: string[] = [];

  if (filters.from?.trim()) {
    parts.push(`from:${quoteIfNeeded(filters.from.trim())}`);
  }

  if (filters.to?.trim()) {
    parts.push(`to:${quoteIfNeeded(filters.to.trim())}`);
  }

  if (filters.subject?.trim()) {
    parts.push(`subject:${quoteIfNeeded(filters.subject.trim())}`);
  }

  if (filters.hasWords?.trim()) {
    parts.push(filters.hasWords.trim());
  }

  if (filters.doesntHave?.trim()) {
    const excluded = tokenizeQuery(filters.doesntHave.trim()).map(
      (w) => `-${quoteIfNeeded(stripQuotes(w))}`
    );
    parts.push(...excluded);
  }

  if (filters.hasAttachment) {
    parts.push("has:attachment");
  }

  if (filters.hasInvite) {
    parts.push("has:invite");
  }

  if (filters.filename?.trim()) {
    parts.push(`filename:${quoteIfNeeded(filters.filename.trim())}`);
  }

  if (filters.sizeValue && filters.sizeRelation) {
    const val = parseFloat(String(filters.sizeValue));
    if (!isNaN(val) && val > 0) {
      const unit = filters.sizeUnit || "MB";
      const token = filters.sizeRelation === "greater" ? "larger" : "smaller";
      parts.push(`${token}:${val}${unit === "Bytes" ? "" : unit}`);
    }
  }

  if (filters.dateWithin && filters.dateWithin !== "custom") {
    // Relative date
    parts.push(`newer_than:${filters.dateWithin}`);
  } else {
    if (filters.startDate?.trim()) {
      parts.push(`after:${filters.startDate.trim()}`);
    }
    if (filters.endDate?.trim()) {
      parts.push(`before:${filters.endDate.trim()}`);
    }
  }

  if (filters.readStatus === "unread") {
    parts.push("is:unread");
  } else if (filters.readStatus === "read") {
    parts.push("is:read");
  }

  if (filters.starredStatus === "starred") {
    parts.push("is:starred");
  }

  if (filters.inView && filters.inView !== "all") {
    parts.push(`in:${filters.inView}`);
  }

  return parts.join(" ");
}

function quoteIfNeeded(str: string): string {
  if (str.includes(" ") || str.includes("\t")) {
    return `"${str.replace(/"/g, '\\"')}"`;
  }
  return str;
}
