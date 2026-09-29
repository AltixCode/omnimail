/**
 * Utilities for RFC 5545 iCalendar Timezone Handling & Display
 */

let cachedValidTzs: Set<string> | null = null;
function getValidTimezones(): Set<string> {
  if (!cachedValidTzs) {
    try {
      cachedValidTzs = new Set(Intl.supportedValuesOf("timeZone"));
    } catch {
      cachedValidTzs = new Set(["UTC", "Europe/Berlin", "Europe/London", "America/New_York", "Asia/Tokyo"]);
    }
  }
  return cachedValidTzs;
}

const COMMON_ALIASES: Record<string, string> = {
  "W. Europe Standard Time": "Europe/Berlin",
  "Central Europe Standard Time": "Europe/Warsaw",
  "Romance Standard Time": "Europe/Paris",
  "GMT Standard Time": "Europe/London",
  "Greenwich Standard Time": "UTC",
  "GTB Standard Time": "Europe/Athens",
  "E. Europe Standard Time": "Europe/Bucharest",
  "FLE Standard Time": "Europe/Kiev",
  "Israel Standard Time": "Asia/Jerusalem",
  "Arabic Standard Time": "Asia/Baghdad",
  "Arab Standard Time": "Asia/Riyadh",
  "Eastern Standard Time": "America/New_York",
  "Central Standard Time": "America/Chicago",
  "Mountain Standard Time": "America/Denver",
  "Pacific Standard Time": "America/Los_Angeles",
};

/**
 * Normalizes an arbitrary timezone string to a standard IANA timezone name.
 */
export function normalizeTimezone(tz?: string | null): string | null {
  if (!tz) return null;
  let clean = tz.trim().replace(/^["'\\]+|["'\\]+$/g, "");
  if (clean === "UTC" || clean === "GMT" || clean === "Z" || clean === "Etc/UTC") return "UTC";
  
  const valid = getValidTimezones();
  if (valid.has(clean)) return clean;

  // Sometimes TZID is prefixed by an organization ID (e.g. /mozilla.org/20050126_1/Europe/Berlin)
  if (clean.includes("/")) {
    const parts = clean.split("/");
    const candidate = parts.slice(-2).join("/");
    if (valid.has(candidate)) return candidate;
  }

  if (COMMON_ALIASES[clean]) {
    return COMMON_ALIASES[clean];
  }

  return null;
}

/**
 * Converts a specific wall-clock date/time in an IANA timezone into exact UTC Date.
 * Handles Daylight Saving Time (DST) accurately using native Intl.
 */
export function wallTimeToUTC(
  year: number,
  month: number, // 1-12
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string
): Date {
  const normTz = normalizeTimezone(timeZone);
  if (!normTz || normTz === "UTC") {
    return new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  }

  try {
    const approx = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: normTz,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
      hourCycle: "h23",
    });

    const getParts = (d: Date) => {
      const parts = formatter.formatToParts(d);
      const map: Record<string, number> = {};
      for (const p of parts) {
        if (p.type !== "literal") {
          map[p.type] = parseInt(p.value, 10);
        }
      }
      return map;
    };

    const targetMs = Date.UTC(year, month - 1, day, hour, minute, second);
    const approxParts = getParts(approx);
    const approxInTzMs = Date.UTC(
      approxParts.year,
      approxParts.month - 1,
      approxParts.day,
      approxParts.hour,
      approxParts.minute,
      approxParts.second || 0
    );
    const diff = targetMs - approxInTzMs;
    const result = new Date(approx.getTime() + diff);

    // One refinement pass for DST transition boundary accuracy
    const testParts = getParts(result);
    const testInTzMs = Date.UTC(
      testParts.year,
      testParts.month - 1,
      testParts.day,
      testParts.hour,
      testParts.minute,
      testParts.second || 0
    );
    const diff2 = targetMs - testInTzMs;
    return new Date(result.getTime() + diff2);
  } catch {
    return new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  }
}

/**
 * Converts an ICAL.Time object into an accurate UTC Date, respecting its timezone.
 */
export function icalTimeToUTC(
  time: any,
  fallbackTzid?: string | null
): { date: Date; timezone: string | null } {
  if (!time) {
    return { date: new Date(), timezone: null };
  }

  if (time.isDate) {
    // All-day event: store as UTC midnight
    return {
      date: new Date(Date.UTC(time.year, time.month - 1, time.day, 0, 0, 0)),
      timezone: null,
    };
  }

  if (time.isUtc) {
    return {
      date: new Date(Date.UTC(time.year, time.month - 1, time.day, time.hour, time.minute, time.second || 0)),
      timezone: "UTC",
    };
  }

  const rawTz = time.timezone || fallbackTzid || null;
  const normTz = normalizeTimezone(rawTz);

  if (normTz && normTz !== "UTC") {
    const utcDate = wallTimeToUTC(
      time.year,
      time.month,
      time.day,
      time.hour,
      time.minute,
      time.second || 0,
      normTz
    );
    return { date: utcDate, timezone: normTz };
  }

  // Floating time or unknown timezone
  return {
    date: new Date(Date.UTC(time.year, time.month - 1, time.day, time.hour, time.minute, time.second || 0)),
    timezone: normTz,
  };
}

/**
 * Returns a human-friendly city or region name from an IANA timezone (e.g. "Berlin", "New York")
 */
export function getTimezoneCity(timeZone?: string | null): string {
  if (!timeZone) return "Local";
  const norm = normalizeTimezone(timeZone);
  if (!norm || norm === "UTC") return "UTC";
  const parts = norm.split("/");
  const city = parts[parts.length - 1];
  return city.replace(/_/g, " ");
}

/**
 * Returns the short timezone abbreviation (e.g. CEST, EEST, EST, GMT+2) for a given date and timezone
 */
export function getTimezoneAbbr(date: Date, timeZone: string): string {
  const norm = normalizeTimezone(timeZone);
  if (!norm || norm === "UTC") return "UTC";
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: norm,
      timeZoneName: "short",
    }).formatToParts(date);
    const tzPart = parts.find((p) => p.type === "timeZoneName");
    return tzPart ? tzPart.value : norm;
  } catch {
    return norm;
  }
}

/**
 * Formats an event's times showing both the user's local device time AND the original event timezone.
 */
export function formatTimeDual(
  startInput: Date | string,
  endInput: Date | string,
  originalTz?: string | null,
  userTz?: string,
  isAllDay?: boolean
): {
  localDisplay: string;
  originalDisplay: string | null;
  hasDifferentTimezone: boolean;
  userTzAbbr: string;
  originalTzAbbr: string | null;
} {
  if (isAllDay) {
    return {
      localDisplay: "All Day",
      originalDisplay: null,
      hasDifferentTimezone: false,
      userTzAbbr: "",
      originalTzAbbr: null,
    };
  }

  const startDate = typeof startInput === "string" ? new Date(startInput) : startInput;
  const endDate = typeof endInput === "string" ? new Date(endInput) : endInput;

  const resolvedUserTz = userTz || (typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "UTC");
  const normOriginalTz = normalizeTimezone(originalTz);

  const localFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: resolvedUserTz,
    hour: "numeric",
    minute: "2-digit",
    hourCycle: "h23",
  });

  const localStart = localFormatter.format(startDate);
  const localEnd = localFormatter.format(endDate);
  const localDisplay = `${localStart} - ${localEnd}`;
  const userTzAbbr = getTimezoneAbbr(startDate, resolvedUserTz);

  const hasDifferentTimezone = Boolean(
    normOriginalTz &&
    normOriginalTz !== "UTC" &&
    normOriginalTz !== resolvedUserTz &&
    normOriginalTz !== normalizeTimezone(resolvedUserTz)
  );

  let originalDisplay: string | null = null;
  let originalTzAbbr: string | null = null;

  if (hasDifferentTimezone && normOriginalTz) {
    try {
      const origFormatter = new Intl.DateTimeFormat("en-US", {
        timeZone: normOriginalTz,
        hour: "numeric",
        minute: "2-digit",
        hourCycle: "h23",
      });
      const origStart = origFormatter.format(startDate);
      const origEnd = origFormatter.format(endDate);
      const city = getTimezoneCity(normOriginalTz);
      originalTzAbbr = getTimezoneAbbr(startDate, normOriginalTz);
      originalDisplay = `${origStart} - ${origEnd} (${city}, ${originalTzAbbr})`;
    } catch {
      originalDisplay = null;
    }
  }

  return {
    localDisplay,
    originalDisplay,
    hasDifferentTimezone,
    userTzAbbr,
    originalTzAbbr,
  };
}
