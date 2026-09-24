"use client";

import React, { useState, useEffect, useMemo } from "react";
import {
  Calendar,
  Clock,
  MapPin,
  Video,
  Check,
  HelpCircle,
  X,
  Users,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Loader2,
  CalendarCheck2,
  AlertTriangle,
  CheckCircle2,
  CalendarDays,
} from "lucide-react";
import type { ParsedCalendarInvite } from "@/lib/calendar-invite";

interface CalendarEventItem {
  id: string;
  uid: string;
  summary: string;
  description?: string | null;
  location?: string | null;
  startDate: string;
  endDate: string;
  isAllDay: boolean;
  calendar?: {
    id: string;
    name: string;
    color: string;
    accountId: string;
    account?: {
      id: string;
      label: string;
      emailAddress: string;
    };
  };
}

interface CalendarItem {
  id: string;
  name: string;
  color: string;
  account?: {
    id: string;
    label: string;
    emailAddress: string;
  };
}

interface CalendarInviteBannerProps {
  messageId: string;
  invite: ParsedCalendarInvite;
  initialRsvpStatus?: "accepted" | "tentative" | "declined" | "needs-action" | null;
  calendarEventId?: string | null;
  onCalendarUpdated?: () => void;
  onNavigateToCalendar?: (dateIso: string) => void;
}

export function CalendarInviteBanner({
  messageId,
  invite,
  initialRsvpStatus = "needs-action",
  onCalendarUpdated,
  onNavigateToCalendar,
}: CalendarInviteBannerProps) {
  const [status, setStatus] = useState<"accepted" | "tentative" | "declined" | "needs-action">(
    initialRsvpStatus || "needs-action"
  );
  const [isUpdating, setIsUpdating] = useState<boolean>(false);
  const [showAttendees, setShowAttendees] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Day Schedule & Conflict State
  const [eventsToday, setEventsToday] = useState<CalendarEventItem[]>([]);
  const [calendars, setCalendars] = useState<CalendarItem[]>([]);
  const [isLoadingSchedule, setIsLoadingSchedule] = useState<boolean>(true);
  const [isScheduleExpanded, setIsScheduleExpanded] = useState<boolean>(false);

  const start = new Date(invite.startDate);
  const end = new Date(invite.endDate);

  const monthShort = start.toLocaleString("en-US", { month: "short" }).toUpperCase();
  const dayNum = start.getDate();
  const dayOfWeek = start.toLocaleString("en-US", { weekday: "short" });

  const formattedDate = start.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  const durationMin = Math.round((end.getTime() - start.getTime()) / (1000 * 60));
  const timeString = invite.isAllDay
    ? "All day"
    : `${start.toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
      })} – ${end.toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        timeZoneName: "short",
      })} (${durationMin > 0 ? `${durationMin} mins` : "1 hr"})`;

  // Fetch all calendar events across all calendars for this specific day
  const fetchDaySchedule = async () => {
    try {
      setIsLoadingSchedule(true);
      const dayStart = new Date(start);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(start);
      dayEnd.setHours(23, 59, 59, 999);

      const res = await fetch(
        `/api/calendar?start=${encodeURIComponent(dayStart.toISOString())}&end=${encodeURIComponent(
          dayEnd.toISOString()
        )}`
      );
      if (res.ok) {
        const data = await res.json();
        const evList: CalendarEventItem[] = data.events || [];
        setEventsToday(evList);
        setCalendars(data.calendars || []);

        // Compute conflicts: check if any event overlaps
        const conflicts = evList.filter((ev) => {
          if (ev.uid === invite.uid) return false;
          const evStart = new Date(ev.startDate).getTime();
          const evEnd = new Date(ev.endDate).getTime();
          if (invite.isAllDay || ev.isAllDay) return true;
          return evStart < end.getTime() && evEnd > start.getTime();
        });

        // Automatically expand schedule view if there is a conflict so the user sees it
        if (conflicts.length > 0) {
          setIsScheduleExpanded(true);
        }
      }
    } catch (err) {
      console.error("Error loading day schedule for invite banner:", err);
    } finally {
      setIsLoadingSchedule(false);
    }
  };

  useEffect(() => {
    fetchDaySchedule();
  }, [invite.startDate, invite.endDate, invite.uid]);

  // Compute conflicts excluding the invite itself
  const otherEventsOnDay = useMemo(() => {
    return eventsToday.filter((ev) => ev.uid !== invite.uid);
  }, [eventsToday, invite.uid]);

  const conflictingEvents = useMemo(() => {
    return otherEventsOnDay.filter((ev) => {
      const evStart = new Date(ev.startDate).getTime();
      const evEnd = new Date(ev.endDate).getTime();
      if (invite.isAllDay || ev.isAllDay) return true;
      return evStart < end.getTime() && evEnd > start.getTime();
    });
  }, [otherEventsOnDay, invite.isAllDay, start, end]);

  const hasConflict = conflictingEvents.length > 0;

  // Build sorted timeline items for the day, interweaving existing events and incoming invite
  const timelineItems = useMemo(() => {
    type TimelineItem =
      | { type: "existing"; event: CalendarEventItem; isConflicting: boolean }
      | { type: "incoming"; isConflicting: boolean };

    const items: Array<TimelineItem & { sortTime: number }> = otherEventsOnDay.map((ev) => ({
      type: "existing",
      event: ev,
      isConflicting: conflictingEvents.some((c) => c.id === ev.id),
      sortTime: new Date(ev.startDate).getTime(),
    }));

    items.push({
      type: "incoming",
      isConflicting: hasConflict,
      sortTime: start.getTime(),
    });

    items.sort((a, b) => a.sortTime - b.sortTime);
    return items;
  }, [otherEventsOnDay, conflictingEvents, hasConflict, start]);

  const formatEventTime = (ev: { startDate: string; endDate: string; isAllDay?: boolean }) => {
    if (ev.isAllDay) return "All day";
    const s = new Date(ev.startDate);
    const e = new Date(ev.endDate);
    return `${s.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    })} – ${e.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
  };

  const handleRsvp = async (action: "accept" | "tentative" | "decline") => {
    if (isUpdating) return;
    setIsUpdating(true);
    setToastMessage(null);

    // Optimistic update
    const previousStatus = status;
    setStatus(action === "accept" ? "accepted" : action === "tentative" ? "tentative" : "declined");

    try {
      const res = await fetch("/api/calendar/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messageId,
          action,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "Failed to submit RSVP");
      }

      const toast =
        action === "accept"
          ? "Accepted! Added to your calendar."
          : action === "tentative"
          ? "Marked as maybe on your calendar."
          : "Declined invitation.";

      setToastMessage(toast);
      setTimeout(() => setToastMessage(null), 4000);
      onCalendarUpdated?.();
      fetchDaySchedule();
    } catch (err: any) {
      console.error("RSVP action failed:", err);
      setStatus(previousStatus);
      alert("Failed to update response: " + err.message);
    } finally {
      setIsUpdating(false);
    }
  };

  const isCancelled = invite.method === "CANCEL" || invite.status === "CANCELLED";

  return (
    <div
      className={`mb-4 border rounded-xl shadow-xs overflow-hidden transition-all ${
        isCancelled
          ? "bg-rose-50/70 border-rose-200"
          : hasConflict
          ? "bg-gradient-to-r from-amber-50/80 via-white to-rose-50/40 border-amber-300"
          : status === "accepted"
          ? "bg-gradient-to-r from-emerald-50/80 via-white to-blue-50/50 border-emerald-200"
          : status === "tentative"
          ? "bg-gradient-to-r from-amber-50/80 via-white to-slate-50 border-amber-200"
          : status === "declined"
          ? "bg-gradient-to-r from-rose-50/60 via-white to-slate-50 border-rose-200"
          : "bg-gradient-to-r from-blue-50/70 via-white to-indigo-50/50 border-blue-200"
      }`}
    >
      <div className="p-4">
        {/* Main Details and RSVP Row */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          {/* Left: Date Badge & Event Details */}
          <div className="flex items-start gap-3.5 min-w-0 flex-1">
            {/* Calendar Badge */}
            <div className="shrink-0 w-12 rounded-lg border border-slate-200 bg-white overflow-hidden shadow-xs text-center">
              <div className="bg-blue-600 text-white text-[10px] font-bold py-0.5 tracking-wider">
                {monthShort}
              </div>
              <div className="text-slate-900 font-extrabold text-base leading-tight py-1">
                {dayNum}
              </div>
              <div className="text-[10px] font-medium text-slate-500 pb-1 border-t border-slate-100">
                {dayOfWeek}
              </div>
            </div>

            {/* Details */}
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-bold text-slate-900 text-sm tracking-tight truncate">
                  {invite.summary}
                </h3>
                {isCancelled && (
                  <span className="px-2 py-0.5 bg-rose-100 text-rose-700 font-semibold text-[10px] rounded-full">
                    Cancelled
                  </span>
                )}
                {status === "accepted" && (
                  <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 font-semibold text-[10px] rounded-full flex items-center gap-1">
                    <Check className="w-3 h-3 text-emerald-600" />
                    <span>On your calendar</span>
                  </span>
                )}
                {status === "tentative" && (
                  <span className="px-2 py-0.5 bg-amber-100 text-amber-800 font-semibold text-[10px] rounded-full flex items-center gap-1">
                    <HelpCircle className="w-3 h-3 text-amber-600" />
                    <span>Tentative</span>
                  </span>
                )}
                {status === "declined" && (
                  <span className="px-2 py-0.5 bg-rose-100 text-rose-800 font-semibold text-[10px] rounded-full flex items-center gap-1">
                    <X className="w-3 h-3 text-rose-600" />
                    <span>Declined</span>
                  </span>
                )}
              </div>

              {/* When */}
              <div className="flex items-center gap-1.5 text-xs text-slate-700 font-medium">
                <Clock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                <span>
                  {formattedDate} · {timeString}
                </span>
              </div>

              {/* Location / Meeting link */}
              {invite.location && (
                <div className="flex items-center gap-2 text-xs text-slate-600 pt-0.5">
                  {invite.isMeetingLink ? (
                    <Video className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                  ) : (
                    <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  )}

                  {invite.meetingLink ? (
                    <a
                      href={invite.meetingLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 font-semibold text-blue-600 hover:text-blue-800 hover:underline"
                    >
                      <span>Join Video Meeting</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  ) : (
                    <span className="truncate">{invite.location}</span>
                  )}
                </div>
              )}

              {/* Organizer */}
              {invite.organizer && (
                <div className="text-[11px] text-slate-500 pt-0.5">
                  <span>Organizer: </span>
                  <span className="font-semibold text-slate-700">
                    {invite.organizer.name}{" "}
                    <span className="font-normal text-slate-400">
                      &lt;{invite.organizer.email}&gt;
                    </span>
                  </span>
                </div>
              )}

              {/* Attendees toggle */}
              {invite.attendees.length > 0 && (
                <div className="pt-0.5">
                  <button
                    type="button"
                    onClick={() => setShowAttendees((p) => !p)}
                    className="text-[11px] text-slate-500 hover:text-slate-800 flex items-center gap-1 font-medium transition-colors cursor-pointer"
                  >
                    <Users className="w-3 h-3 text-slate-400" />
                    <span>
                      {invite.attendees.length} guest{invite.attendees.length > 1 ? "s" : ""}
                    </span>
                    {showAttendees ? (
                      <ChevronUp className="w-3 h-3 text-slate-400" />
                    ) : (
                      <ChevronDown className="w-3 h-3 text-slate-400" />
                    )}
                  </button>

                  {showAttendees && (
                    <div className="mt-1.5 p-2 bg-white/90 border border-slate-200/80 rounded-lg max-h-36 overflow-y-auto space-y-1 text-[11px]">
                      {invite.attendees.map((att, idx) => (
                        <div
                          key={idx}
                          className="flex items-center justify-between gap-2 text-slate-700"
                        >
                          <span className="truncate font-medium">
                            {att.name}{" "}
                            <span className="text-slate-400 font-normal">({att.email})</span>
                          </span>
                          <span
                            className={`text-[9px] px-1.5 py-0.5 rounded font-semibold shrink-0 ${
                              att.partstat === "ACCEPTED"
                                ? "bg-emerald-100 text-emerald-800"
                                : att.partstat === "DECLINED"
                                ? "bg-rose-100 text-rose-800"
                                : att.partstat === "TENTATIVE"
                                ? "bg-amber-100 text-amber-800"
                                : "bg-slate-100 text-slate-600"
                            }`}
                          >
                            {att.partstat}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Right: RSVP Actions */}
          <div className="shrink-0 flex flex-col md:items-end justify-center gap-2 pt-2 md:pt-0 border-t md:border-t-0 border-slate-200/60">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-700">Going?</span>
              <div className="inline-flex rounded-lg border border-slate-300 bg-white p-0.5 shadow-2xs text-xs font-semibold">
                <button
                  type="button"
                  disabled={isUpdating}
                  onClick={() => handleRsvp("accept")}
                  className={`px-3 py-1.5 rounded-md transition-all flex items-center gap-1 cursor-pointer ${
                    status === "accepted"
                      ? "bg-emerald-600 text-white shadow-2xs font-bold"
                      : "text-slate-700 hover:text-emerald-700 hover:bg-emerald-50"
                  }`}
                  title="Accept invitation and add to calendar"
                >
                  {isUpdating && status === "accepted" ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Check className="w-3 h-3" />
                  )}
                  <span>Yes</span>
                </button>

                <button
                  type="button"
                  disabled={isUpdating}
                  onClick={() => handleRsvp("tentative")}
                  className={`px-3 py-1.5 rounded-md transition-all flex items-center gap-1 cursor-pointer ${
                    status === "tentative"
                      ? "bg-amber-500 text-white shadow-2xs font-bold"
                      : "text-slate-700 hover:text-amber-700 hover:bg-amber-50"
                  }`}
                  title="Respond Maybe and tentatively hold date"
                >
                  {isUpdating && status === "tentative" ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <HelpCircle className="w-3 h-3" />
                  )}
                  <span>Maybe</span>
                </button>

                <button
                  type="button"
                  disabled={isUpdating}
                  onClick={() => handleRsvp("decline")}
                  className={`px-3 py-1.5 rounded-md transition-all flex items-center gap-1 cursor-pointer ${
                    status === "declined"
                      ? "bg-rose-600 text-white shadow-2xs font-bold"
                      : "text-slate-700 hover:text-rose-700 hover:bg-rose-50"
                  }`}
                  title="Decline invitation"
                >
                  {isUpdating && status === "declined" ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <X className="w-3 h-3" />
                  )}
                  <span>No</span>
                </button>
              </div>
            </div>

            {/* Quick link to jump to date in Calendar */}
            <button
              type="button"
              onClick={() => onNavigateToCalendar?.(invite.startDate)}
              className="text-[11px] text-blue-600 hover:text-blue-800 hover:underline flex items-center gap-1 font-medium transition-colors cursor-pointer"
            >
              <CalendarCheck2 className="w-3.5 h-3.5" />
              <span>View in Calendar</span>
            </button>

            {/* Toast / confirmation message */}
            {toastMessage && (
              <div className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200 animate-in fade-in-50">
                {toastMessage}
              </div>
            )}
          </div>
        </div>

        {/* ------------------------------------------------------------------ */}
        {/* Conflict Warning & Schedule Banner                                */}
        {/* ------------------------------------------------------------------ */}
        {isLoadingSchedule ? (
          <div className="mt-3.5 p-2.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-500 text-xs flex items-center gap-2">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-600" />
            <span>Checking all your calendars for scheduling conflicts...</span>
          </div>
        ) : hasConflict ? (
          /* CONFLICT DETECTED BANNER */
          <div className="mt-3.5 p-3 rounded-xl bg-rose-50/90 border border-rose-300 shadow-2xs text-rose-900">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-2.5">
                <div className="p-1.5 rounded-lg bg-rose-100 text-rose-700 shrink-0 mt-0.5">
                  <AlertTriangle className="w-4 h-4 text-rose-600" />
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-extrabold text-xs text-rose-900 tracking-tight">
                      ⚠️ Schedule Conflict Warning
                    </span>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-200 text-rose-800 border border-rose-300">
                      {conflictingEvents.length} conflicting event
                      {conflictingEvents.length > 1 ? "s" : ""}
                    </span>
                  </div>
                  <p className="text-xs text-rose-800 mt-1 leading-relaxed">
                    This invitation directly overlaps with{" "}
                    {conflictingEvents.map((c, idx) => (
                      <span key={c.id}>
                        <strong className="font-bold text-rose-950">
                          &ldquo;{c.summary}&rdquo;
                        </strong>{" "}
                        ({formatEventTime(c)}) on{" "}
                        <span className="font-semibold text-slate-900">
                          {c.calendar?.name || "Calendar"}
                        </span>
                        {c.calendar?.account?.label && ` (${c.calendar.account.label})`}
                        {idx < conflictingEvents.length - 1 ? "; " : ""}
                      </span>
                    ))}
                    .
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setIsScheduleExpanded((prev) => !prev)}
                className="text-xs font-bold text-rose-800 hover:text-rose-950 px-2.5 py-1.5 rounded-lg bg-rose-100/90 hover:bg-rose-200 border border-rose-200 transition-colors shrink-0 flex items-center gap-1 cursor-pointer"
              >
                <span>{isScheduleExpanded ? "Hide Day Schedule" : "View Day Schedule"}</span>
                {isScheduleExpanded ? (
                  <ChevronUp className="w-3.5 h-3.5" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5" />
                )}
              </button>
            </div>
          </div>
        ) : (
          /* NO CONFLICT BANNER */
          <div className="mt-3.5 p-2.5 rounded-xl bg-emerald-50/90 border border-emerald-200 text-emerald-900 shadow-2xs">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-xs">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>
                  <strong className="font-bold text-emerald-950">No schedule conflict.</strong>{" "}
                  {otherEventsOnDay.length === 0
                    ? "You are completely free with no other events scheduled on this day."
                    : `Your time is clear for this invitation (${otherEventsOnDay.length} other event${
                        otherEventsOnDay.length > 1 ? "s" : ""
                      } on this date across your calendars).`}
                </span>
              </div>

              {otherEventsOnDay.length > 0 && (
                <button
                  type="button"
                  onClick={() => setIsScheduleExpanded((prev) => !prev)}
                  className="text-xs font-semibold text-emerald-800 hover:text-emerald-950 px-2.5 py-1 rounded-md bg-emerald-100/80 hover:bg-emerald-200 border border-emerald-200 transition-colors shrink-0 flex items-center gap-1 cursor-pointer"
                >
                  <span>{isScheduleExpanded ? "Hide Schedule" : "View Day Schedule"}</span>
                  {isScheduleExpanded ? (
                    <ChevronUp className="w-3.5 h-3.5" />
                  ) : (
                    <ChevronDown className="w-3.5 h-3.5" />
                  )}
                </button>
              )}
            </div>
          </div>
        )}

        {/* ------------------------------------------------------------------ */}
        {/* Comprehensive Day Schedule & Timeline Widget                      */}
        {/* ------------------------------------------------------------------ */}
        {isScheduleExpanded && (
          <div className="mt-3.5 pt-3.5 border-t border-slate-200/80 space-y-2.5 animate-in fade-in-50 duration-150">
            {/* Schedule Header & Calendar Badges */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-slate-700">
              <div className="flex items-center gap-2 font-bold text-slate-900">
                <CalendarDays className="w-4 h-4 text-blue-600 shrink-0" />
                <span>Schedule for {formattedDate}</span>
                <span className="text-[11px] font-normal text-slate-500">
                  ({otherEventsOnDay.length} existing event{otherEventsOnDay.length !== 1 ? "s" : ""})
                </span>
              </div>

              {calendars.length > 0 && (
                <div className="flex items-center gap-1.5 flex-wrap text-[11px]">
                  <span className="text-slate-400 font-medium">Calendars:</span>
                  {calendars.map((cal) => (
                    <span
                      key={cal.id}
                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-white border border-slate-200 text-slate-700 font-medium text-[10px] shadow-2xs"
                      title={cal.account?.label || cal.name}
                    >
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: cal.color || "#3b82f6" }}
                      />
                      <span className="max-w-[120px] truncate">{cal.name}</span>
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Timeline List of Events */}
            <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
              {timelineItems.length === 0 ? (
                <div className="p-4 text-center rounded-lg bg-white border border-slate-200 text-slate-500 text-xs">
                  No other events on this day.
                </div>
              ) : (
                timelineItems.map((item, idx) => {
                  if (item.type === "incoming") {
                    return (
                      <div
                        key={`incoming-${idx}`}
                        className={`p-3 rounded-lg border-2 border-dashed shadow-xs transition-all ${
                          item.isConflicting
                            ? "bg-rose-50/70 border-rose-400 text-rose-950 ring-2 ring-rose-300/40"
                            : "bg-blue-50/70 border-blue-400 text-blue-950 ring-2 ring-blue-300/40"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1 space-y-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span
                                className={`px-2 py-0.5 rounded text-[10px] font-extrabold uppercase tracking-wide ${
                                  item.isConflicting
                                    ? "bg-rose-600 text-white"
                                    : "bg-blue-600 text-white"
                                }`}
                              >
                                ⚡ Incoming Invitation
                              </span>
                              <h4 className="font-bold text-xs truncate">{invite.summary}</h4>
                              {item.isConflicting ? (
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-200 text-rose-900 border border-rose-300 flex items-center gap-1">
                                  <AlertTriangle className="w-3 h-3 text-rose-700" />
                                  <span>Time Conflict</span>
                                </span>
                              ) : (
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200 flex items-center gap-1">
                                  <Check className="w-3 h-3 text-emerald-700" />
                                  <span>Slot Free</span>
                                </span>
                              )}
                            </div>

                            <div className="flex items-center gap-2 text-xs font-semibold text-slate-700">
                              <Clock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                              <span>{timeString}</span>
                            </div>

                            {invite.location && (
                              <div className="flex items-center gap-1.5 text-xs text-slate-600">
                                {invite.isMeetingLink ? (
                                  <Video className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                                ) : (
                                  <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                                )}
                                <span className="truncate">{invite.location}</span>
                              </div>
                            )}
                          </div>

                          <div className="shrink-0 text-right">
                            <span className="text-[10px] font-bold px-2 py-1 rounded bg-white/90 border border-slate-200 text-slate-700">
                              {status === "accepted"
                                ? "Accepted"
                                : status === "tentative"
                                ? "Tentative"
                                : status === "declined"
                                ? "Declined"
                                : "Needs Response"}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  }

                  const ev = item.event;
                  const isConflicting = item.isConflicting;
                  const calColor = ev.calendar?.color || "#3b82f6";

                  return (
                    <div
                      key={ev.id}
                      className={`p-2.5 rounded-lg border text-xs transition-all ${
                        isConflicting
                          ? "bg-rose-50 border-rose-300 text-rose-950 shadow-2xs ring-1 ring-rose-200"
                          : "bg-white border-slate-200 text-slate-800 hover:border-slate-300"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span
                              className="w-2.5 h-2.5 rounded-full shrink-0"
                              style={{ backgroundColor: calColor }}
                            />
                            <h4
                              className={`font-bold truncate ${
                                isConflicting ? "text-rose-950 font-extrabold" : "text-slate-900"
                              }`}
                            >
                              {ev.summary}
                            </h4>

                            {isConflicting ? (
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-200 text-rose-900 border border-rose-300 flex items-center gap-1">
                                <AlertTriangle className="w-3 h-3 text-rose-700" />
                                <span>Conflicts with this invite</span>
                              </span>
                            ) : (
                              <span className="px-1.5 py-0.2 rounded text-[10px] font-medium bg-slate-100 text-slate-600">
                                Clear
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-2 text-[11px] text-slate-600 font-medium">
                            <Clock className="w-3 h-3 text-slate-400 shrink-0" />
                            <span>{formatEventTime(ev)}</span>
                            <span>•</span>
                            <span className="font-semibold text-slate-700">
                              {ev.calendar?.name || "Calendar"}
                            </span>
                            {ev.calendar?.account?.label && (
                              <span className="text-slate-400 text-[10px]">
                                ({ev.calendar.account.label})
                              </span>
                            )}
                          </div>

                          {ev.location && (
                            <div className="flex items-center gap-1.5 text-[11px] text-slate-500 pt-0.5">
                              <MapPin className="w-3 h-3 text-slate-400 shrink-0" />
                              <span className="truncate">{ev.location}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Bottom Footer Action */}
            <div className="pt-2 flex items-center justify-between text-xs text-slate-500 border-t border-slate-100">
              <span>All your calendars are synchronized in real-time.</span>
              <button
                type="button"
                onClick={() => onNavigateToCalendar?.(invite.startDate)}
                className="text-blue-600 hover:text-blue-800 hover:underline font-semibold flex items-center gap-1 cursor-pointer"
              >
                <span>Open Full Calendar</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
