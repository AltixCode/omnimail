"use client";

import React, { useState } from "react";
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
} from "lucide-react";
import type { ParsedCalendarInvite } from "@/lib/calendar-invite";

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
          : status === "accepted"
          ? "bg-gradient-to-r from-emerald-50/80 via-white to-blue-50/50 border-emerald-200"
          : status === "tentative"
          ? "bg-gradient-to-r from-amber-50/80 via-white to-slate-50 border-amber-200"
          : status === "declined"
          ? "bg-gradient-to-r from-rose-50/60 via-white to-slate-50 border-rose-200"
          : "bg-gradient-to-r from-blue-50/70 via-white to-indigo-50/50 border-blue-200"
      }`}
    >
      <div className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
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
                  className="text-[11px] text-slate-500 hover:text-slate-800 flex items-center gap-1 font-medium transition-colors"
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
                  <div className="mt-1.5 p-2 bg-white/80 border border-slate-200/80 rounded-lg max-h-36 overflow-y-auto space-y-1 text-[11px]">
                    {invite.attendees.map((att, idx) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between gap-2 text-slate-700"
                      >
                        <span className="truncate font-medium">
                          {att.name}{" "}
                          <span className="text-slate-400 font-normal">
                            ({att.email})
                          </span>
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
                className={`px-3 py-1.5 rounded-md transition-all flex items-center gap-1 ${
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
                className={`px-3 py-1.5 rounded-md transition-all flex items-center gap-1 ${
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
                className={`px-3 py-1.5 rounded-md transition-all flex items-center gap-1 ${
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
            className="text-[11px] text-blue-600 hover:text-blue-800 hover:underline flex items-center gap-1 font-medium transition-colors"
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
    </div>
  );
}
