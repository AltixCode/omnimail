"use client";

import React, { useState, useEffect, useMemo } from "react";
import {
  format,
  addMonths,
  subMonths,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  isSameMonth,
  isSameDay,
  isToday,
  addDays,
  subDays,
  parseISO,
} from "date-fns";
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Calendar as CalendarIcon,
  Clock,
  MapPin,
  RefreshCw,
  Trash2,
  X,
  Loader2,
  Video,
  ExternalLink,
  Users,
  Link2,
} from "lucide-react";
import { CALENDAR_PALETTE } from "@/lib/calendar-colors";

interface CalendarItem {
  id: string;
  name: string;
  color: string;
  accountId: string;
  account?: {
    label: string;
    emailAddress: string;
  };
}

interface CalendarEventItem {
  id: string;
  calendarId: string;
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
  };
}

interface CalendarViewProps {
  onRefreshTrigger?: () => void;
  initialDate?: Date | null;
}

export function CalendarView({ onRefreshTrigger, initialDate }: CalendarViewProps) {
  const [currentDate, setCurrentDate] = useState<Date>(initialDate || new Date());
  const [viewMode, setViewMode] = useState<"month" | "week" | "day" | "agenda">("month");
  const [calendars, setCalendars] = useState<CalendarItem[]>([]);
  const [events, setEvents] = useState<CalendarEventItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEventItem | null>(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState<boolean>(false);

  const [selectedCalendarIds, setSelectedCalendarIds] = useState<string[]>([]);

  // Form state for creating event
  const [newEventSummary, setNewEventSummary] = useState<string>("");
  const [newEventCalendarId, setNewEventCalendarId] = useState<string>("");
  const [newEventStartDate, setNewEventStartDate] = useState<string>(
    new Date().toISOString().slice(0, 16)
  );
  const [newEventEndDate, setNewEventEndDate] = useState<string>(
    new Date(Date.now() + 3600000).toISOString().slice(0, 16)
  );
  const [newEventIsAllDay, setNewEventIsAllDay] = useState<boolean>(false);
  const [newEventLocation, setNewEventLocation] = useState<string>("");
  const [newEventDescription, setNewEventDescription] = useState<string>("");
  const [isSaving, setIsSaving] = useState<boolean>(false);

  const displayEvents = useMemo(() => {
    if (selectedCalendarIds.length === 0) return events;
    return events.filter((ev) => selectedCalendarIds.includes(ev.calendarId));
  }, [events, selectedCalendarIds]);

  const calendarColorMap = useMemo(() => {
    const map: Record<string, string> = {};
    const used = new Set<string>();

    calendars.forEach((cal, idx) => {
      let color = cal.color;
      if (!color || color === "#3b82f6" || used.has(color)) {
        for (const candidate of CALENDAR_PALETTE) {
          if (!used.has(candidate)) {
            color = candidate;
            break;
          }
        }
        if (!color || used.has(color)) {
          color = CALENDAR_PALETTE[idx % CALENDAR_PALETTE.length];
        }
      }
      used.add(color);
      map[cal.id] = color;
    });

    return map;
  }, [calendars]);

  const getCalColor = (calId?: string, fallback?: string): string => {
    if (calId && calendarColorMap[calId]) return calendarColorMap[calId];
    return fallback && fallback !== "#3b82f6" ? fallback : CALENDAR_PALETTE[0];
  };

  const fetchCalendarData = async () => {
    try {
      setIsLoading(true);
      const res = await fetch("/api/calendar");
      if (res.ok) {
        const data = await res.json();
        const incomingCals = data.calendars || [];
        setCalendars(incomingCals);
        setEvents(data.events || []);
        if (incomingCals.length > 0) {
          setNewEventCalendarId((prev) => {
            if (prev && incomingCals.some((c: any) => c.id === prev)) {
              return prev;
            }
            return incomingCals[0].id;
          });
        }
      }
    } catch (err) {
      console.error("Failed to load calendars:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchCalendarData();
  }, []);

  useEffect(() => {
    if (initialDate) {
      setCurrentDate(initialDate);
    }
  }, [initialDate]);

  const handleSync = async () => {
    setIsSyncing(true);
    try {
      await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      await fetchCalendarData();
      onRefreshTrigger?.();
    } catch (err) {
      console.error("Error syncing calendars:", err);
    } finally {
      setIsSyncing(false);
    }
  };

  const handleCreateEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEventSummary.trim()) return;

    setIsSaving(true);
    try {
      const res = await fetch("/api/calendar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          calendarId: newEventCalendarId,
          summary: newEventSummary,
          startDate: new Date(newEventStartDate).toISOString(),
          endDate: new Date(newEventEndDate).toISOString(),
          isAllDay: newEventIsAllDay,
          location: newEventLocation || undefined,
          description: newEventDescription || undefined,
        }),
      });

      if (res.ok) {
        setIsCreateModalOpen(false);
        setNewEventSummary("");
        setNewEventLocation("");
        setNewEventDescription("");
        await fetchCalendarData();
      }
    } catch (err) {
      console.error("Error creating event:", err);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteEvent = async (id: string) => {
    if (!confirm("Are you sure you want to delete this event?")) return;
    try {
      const res = await fetch(`/api/calendar/${id}`, { method: "DELETE" });
      if (res.ok) {
        setSelectedEvent(null);
        setEvents((prev) => prev.filter((ev) => ev.id !== id));
      }
    } catch (err) {
      console.error("Error deleting event:", err);
    }
  };

  // Month navigation days
  const monthDays = useMemo(() => {
    const monthStart = startOfMonth(currentDate);
    const monthEnd = endOfMonth(monthStart);
    const startDate = startOfWeek(monthStart, { weekStartsOn: 1 });
    const endDate = endOfWeek(monthEnd, { weekStartsOn: 1 });
    return eachDayOfInterval({ start: startDate, end: endDate });
  }, [currentDate]);

  // Week navigation days
  const weekDays = useMemo(() => {
    const start = startOfWeek(currentDate, { weekStartsOn: 1 });
    const end = endOfWeek(currentDate, { weekStartsOn: 1 });
    return eachDayOfInterval({ start, end });
  }, [currentDate]);

  const prevPeriod = () => {
    if (viewMode === "month") setCurrentDate(subMonths(currentDate, 1));
    else if (viewMode === "week") setCurrentDate(subDays(currentDate, 7));
    else setCurrentDate(subDays(currentDate, 1));
  };

  const nextPeriod = () => {
    if (viewMode === "month") setCurrentDate(addMonths(currentDate, 1));
    else if (viewMode === "week") setCurrentDate(addDays(currentDate, 7));
    else setCurrentDate(addDays(currentDate, 1));
  };

  return (
    <div className="flex flex-col h-full bg-slate-50 text-slate-800">
      {/* Calendar Top Navigation Header */}
      <div className="flex items-center justify-between px-6 py-3.5 bg-white border-b border-slate-200">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            <button
              onClick={prevPeriod}
              className="p-1.5 rounded hover:bg-slate-100 text-slate-600 transition-colors"
              title="Previous"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <button
              onClick={nextPeriod}
              className="p-1.5 rounded hover:bg-slate-100 text-slate-600 transition-colors"
              title="Next"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>

          <h2 className="text-lg font-bold text-slate-900 tracking-tight min-w-[200px]">
            {format(currentDate, viewMode === "month" ? "MMMM yyyy" : "MMM d, yyyy")}
          </h2>

          <button
            onClick={() => setCurrentDate(new Date())}
            className="px-2.5 py-1 text-xs font-medium text-slate-600 border border-slate-300 rounded hover:bg-slate-50 transition-colors"
          >
            Today
          </button>
        </div>

        {/* View Switcher & Action buttons */}
        <div className="flex items-center gap-2">
          <div className="flex items-center bg-slate-100 p-0.5 rounded-lg border border-slate-200 text-xs font-medium">
            <button
              onClick={() => setViewMode("month")}
              className={`px-3 py-1 rounded-md transition-colors ${
                viewMode === "month" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Month
            </button>
            <button
              onClick={() => setViewMode("week")}
              className={`px-3 py-1 rounded-md transition-colors ${
                viewMode === "week" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Week
            </button>
            <button
              onClick={() => setViewMode("day")}
              className={`px-3 py-1 rounded-md transition-colors ${
                viewMode === "day" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Day
            </button>
            <button
              onClick={() => setViewMode("agenda")}
              className={`px-3 py-1 rounded-md transition-colors ${
                viewMode === "agenda" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Agenda
            </button>
          </div>

          <button
            onClick={handleSync}
            disabled={isSyncing}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors"
            title="Sync CalDAV"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? "animate-spin text-blue-600" : ""}`} />
            <span>Sync</span>
          </button>

          <button
            onClick={() => setIsCreateModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors shadow-sm"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Event</span>
          </button>
        </div>
      </div>

      {/* Calendar Filter Pills Bar */}
      {calendars.length > 0 && (
        <div className="px-6 py-2 bg-slate-50/70 border-b border-slate-200 flex items-center gap-1.5 overflow-x-auto text-xs shrink-0">
          <span className="text-slate-400 font-medium text-[11px] shrink-0 mr-1">Calendars:</span>
          {calendars.map((cal) => {
            const isSelected = selectedCalendarIds.length === 0 || selectedCalendarIds.includes(cal.id);
            const accountLabel = cal.account?.label || cal.account?.emailAddress || "Account";
            const isSame = cal.name === accountLabel || cal.name === cal.account?.emailAddress;
            const label = isSame ? accountLabel : `${accountLabel} (${cal.name})`;

            return (
              <button
                key={cal.id}
                type="button"
                onClick={() => {
                  setSelectedCalendarIds((prev) => {
                    if (prev.length === 0) {
                      return [cal.id];
                    }
                    if (prev.includes(cal.id)) {
                      const next = prev.filter((id) => id !== cal.id);
                      return next;
                    } else {
                      return [...prev, cal.id];
                    }
                  });
                }}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${
                  isSelected
                    ? "bg-white border-slate-300 text-slate-800 shadow-2xs"
                    : "bg-slate-100/70 border-transparent text-slate-400 opacity-60 hover:opacity-100"
                }`}
                title={`Filter events for ${label}`}
              >
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: getCalColor(cal.id, cal.color) }}
                />
                <span className="truncate max-w-[220px]">{label}</span>
              </button>
            );
          })}
          {selectedCalendarIds.length > 0 && (
            <button
              type="button"
              onClick={() => setSelectedCalendarIds([])}
              className="text-[11px] text-blue-600 hover:text-blue-800 font-medium ml-2 shrink-0 cursor-pointer"
            >
              Reset filter
            </button>
          )}
        </div>
      )}

      {/* Main View Area */}
      <div className="flex-1 overflow-auto p-4">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-2">
            <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
            <span className="text-xs">Loading calendar events...</span>
          </div>
        ) : viewMode === "month" ? (
          /* MONTH GRID */
          <div className="flex flex-col h-full bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
            {/* Weekday names */}
            <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50 text-center py-2 text-xs font-semibold text-slate-500 uppercase tracking-wider">
              <div>Mon</div>
              <div>Tue</div>
              <div>Wed</div>
              <div>Thu</div>
              <div>Fri</div>
              <div>Sat</div>
              <div>Sun</div>
            </div>

            {/* Month Day Cells */}
            <div className="grid grid-cols-7 flex-1 auto-rows-fr">
              {monthDays.map((day, idx) => {
                const dayEvents = displayEvents.filter((ev) => isSameDay(parseISO(ev.startDate), day));
                const inCurrentMonth = isSameMonth(day, currentDate);
                const currentDay = isToday(day);

                return (
                  <div
                    key={idx}
                    onClick={() => {
                      setNewEventStartDate(format(day, "yyyy-MM-dd'T'09:00"));
                      setNewEventEndDate(format(day, "yyyy-MM-dd'T'10:00"));
                      setIsCreateModalOpen(true);
                    }}
                    className={`min-h-[90px] p-1.5 border-b border-r border-slate-100 flex flex-col cursor-pointer transition-colors hover:bg-slate-50/80 ${
                      !inCurrentMonth ? "bg-slate-50/50 text-slate-400" : "bg-white text-slate-800"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span
                        className={`text-xs font-semibold w-6 h-6 flex items-center justify-center rounded-full ${
                          currentDay
                            ? "bg-blue-600 text-white shadow-sm"
                            : inCurrentMonth
                            ? "text-slate-800"
                            : "text-slate-400"
                        }`}
                      >
                        {format(day, "d")}
                      </span>
                      {dayEvents.length > 0 && (
                        <span className="text-[10px] text-slate-400 font-medium">
                          {dayEvents.length}
                        </span>
                      )}
                    </div>

                    <div className="flex flex-col gap-1 overflow-y-auto max-h-[85px] no-scrollbar">
                      {dayEvents.slice(0, 3).map((ev) => {
                        const calColor = getCalColor(ev.calendarId || ev.calendar?.id, ev.calendar?.color);
                        return (
                          <div
                            key={ev.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedEvent(ev);
                            }}
                            style={{ borderLeftColor: calColor }}
                            className="px-1.5 py-0.5 text-[11px] rounded bg-slate-100 hover:bg-slate-200 border-l-[3px] truncate font-medium text-slate-700 shadow-2xs"
                          >
                            <span className="font-semibold text-slate-900 mr-1">
                              {ev.isAllDay ? "All Day" : format(parseISO(ev.startDate), "HH:mm")}
                            </span>
                            {ev.summary}
                          </div>
                        );
                      })}
                      {dayEvents.length > 3 && (
                        <span className="text-[10px] text-slate-400 font-medium px-1">
                          +{dayEvents.length - 3} more
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : viewMode === "week" ? (
          /* WEEK VIEW */
          <div className="flex flex-col h-full bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
            <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50 py-2.5 text-center">
              {weekDays.map((day, idx) => (
                <div key={idx} className="flex flex-col items-center">
                  <span className="text-xs uppercase text-slate-500 font-semibold">
                    {format(day, "EEE")}
                  </span>
                  <span
                    className={`text-sm font-bold mt-0.5 w-7 h-7 flex items-center justify-center rounded-full ${
                      isToday(day) ? "bg-blue-600 text-white" : "text-slate-800"
                    }`}
                  >
                    {format(day, "d")}
                  </span>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-7 flex-1 divide-x divide-slate-100 p-2 overflow-y-auto">
              {weekDays.map((day, idx) => {
                const dayEvents = displayEvents.filter((ev) => isSameDay(parseISO(ev.startDate), day));
                return (
                  <div key={idx} className="flex flex-col gap-1.5 min-h-[300px] px-1">
                    {dayEvents.map((ev) => (
                      <div
                        key={ev.id}
                        onClick={() => setSelectedEvent(ev)}
                        style={{ borderLeftColor: getCalColor(ev.calendarId || ev.calendar?.id, ev.calendar?.color) }}
                        className="p-2 text-xs rounded bg-slate-50 hover:bg-slate-100 border border-slate-200 border-l-4 cursor-pointer shadow-xs transition-shadow"
                      >
                        <div className="text-[10px] font-bold text-slate-500">
                          {ev.isAllDay
                            ? "All Day"
                            : `${format(parseISO(ev.startDate), "HH:mm")} - ${format(
                                parseISO(ev.endDate),
                                "HH:mm"
                              )}`}
                        </div>
                        <div className="font-semibold text-slate-900 mt-0.5">{ev.summary}</div>
                        {ev.location && (
                          <div className="text-[10px] text-slate-500 flex items-center gap-1 mt-1 truncate">
                            <MapPin className="w-3 h-3 text-slate-400 shrink-0" />
                            <span>{ev.location}</span>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          /* AGENDA / DAY LIST VIEW */
          <div className="bg-white rounded-xl border border-slate-200 p-4 max-w-3xl mx-auto shadow-sm">
            <h3 className="text-sm font-bold text-slate-900 mb-3 uppercase tracking-wide">
              Upcoming Events
            </h3>
            {displayEvents.length === 0 ? (
              <div className="py-12 text-center text-slate-400 text-xs">
                No events scheduled. Click "New Event" or "Sync" to get started.
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {displayEvents.map((ev) => (
                  <div
                    key={ev.id}
                    onClick={() => setSelectedEvent(ev)}
                    className="py-3 px-2 flex items-start justify-between hover:bg-slate-50 rounded-lg cursor-pointer transition-colors"
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className="w-3 h-3 rounded-full mt-1.5 shrink-0"
                        style={{ backgroundColor: getCalColor(ev.calendarId || ev.calendar?.id, ev.calendar?.color) }}
                      />
                      <div>
                        <h4 className="text-sm font-semibold text-slate-900">{ev.summary}</h4>
                        <div className="flex items-center gap-3 text-xs text-slate-500 mt-1">
                          <span className="flex items-center gap-1">
                            <Clock className="w-3.5 h-3.5 text-slate-400" />
                            {format(parseISO(ev.startDate), "MMM d, yyyy · HH:mm")}
                          </span>
                          {ev.location && (
                            <span className="flex items-center gap-1">
                              <MapPin className="w-3.5 h-3.5 text-slate-400" />
                              {ev.location}
                            </span>
                          )}
                        </div>
                        {ev.description && (
                          <p className="text-xs text-slate-600 mt-1.5 line-clamp-2">
                            {ev.description}
                          </p>
                        )}
                      </div>
                    </div>
                    <span className="text-[11px] font-medium text-slate-400 px-2 py-1 bg-slate-100 rounded">
                      {ev.calendar?.name || "Calendar"}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* EVENT DETAIL MODAL */}
      {selectedEvent && (() => {
        const combined = `${selectedEvent.location || ""} ${selectedEvent.description || ""} ${selectedEvent.summary || ""}`;
        let meeting: { type: string; url: string; color: string } | null = null;
        const meetMatch = combined.match(/https:\/\/meet\.google\.com\/[a-z0-9-]+/i);
        if (meetMatch) {
          meeting = { type: "Google Meet", url: meetMatch[0], color: "bg-emerald-600 hover:bg-emerald-700 text-white" };
        } else {
          const zoomMatch =
            combined.match(/https:\/\/(?:[a-zA-Z0-9-]+\.)?zoom\.us\/(?:j|my)\/[a-zA-Z0-9?=_&.-]+/i) ||
            combined.match(/https:\/\/(?:[a-zA-Z0-9-]+\.)?zoom\.us\/[a-zA-Z0-9?=_&.-]+/i);
          if (zoomMatch) {
            meeting = { type: "Zoom", url: zoomMatch[0], color: "bg-blue-600 hover:bg-blue-700 text-white" };
          } else {
            const teamsMatch = combined.match(/https:\/\/teams\.microsoft\.com\/l\/meetup-join\/[^\s"'>]+/i);
            if (teamsMatch) {
              meeting = { type: "Microsoft Teams", url: teamsMatch[0], color: "bg-indigo-600 hover:bg-indigo-700 text-white" };
            } else {
              const webexMatch = combined.match(/https:\/\/[a-zA-Z0-9-]+\.webex\.com\/[^\s"'>]+/i);
              if (webexMatch) {
                meeting = { type: "Webex", url: webexMatch[0], color: "bg-teal-600 hover:bg-teal-700 text-white" };
              }
            }
          }
        }

        // Extract attendee emails mentioned in description or location
        const emailMatches = Array.from(new Set(combined.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || []));

        const renderWithLinks = (text: string) => {
          if (!text) return null;
          const urlRegex = /(https?:\/\/[^\s<]+[^<.,:;"')\]\s])/g;
          const parts = text.split(urlRegex);
          return parts.map((part, index) => {
            if (part.match(urlRegex)) {
              return (
                <a
                  key={index}
                  href={part}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:underline break-all inline-flex items-center gap-0.5 font-medium"
                >
                  {part}
                  <ExternalLink className="w-2.5 h-2.5 inline shrink-0 opacity-70" />
                </a>
              );
            }
            return <span key={index}>{part}</span>;
          });
        };

        return (
          <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-lg w-full p-6 overflow-hidden animate-in fade-in-50 zoom-in-95 max-h-[90vh] flex flex-col">
              {/* Header */}
              <div className="flex items-start justify-between pb-3 border-b border-slate-100 shrink-0">
                <div className="flex items-center gap-2">
                  <div
                    className="w-3.5 h-3.5 rounded-full ring-2 ring-white shadow-xs"
                    style={{ backgroundColor: getCalColor(selectedEvent.calendarId || selectedEvent.calendar?.id, selectedEvent.calendar?.color) }}
                  />
                  <span className="text-xs font-semibold text-slate-700">
                    {selectedEvent.calendar?.name || "Calendar"}
                  </span>
                </div>
                <button
                  onClick={() => setSelectedEvent(null)}
                  className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Scrollable Content */}
              <div className="overflow-y-auto py-4 space-y-4 text-xs text-slate-600 flex-1 pr-1">
                <div>
                  <h3 className="text-lg font-bold text-slate-900 leading-snug">
                    {selectedEvent.summary}
                  </h3>
                  <div className="flex items-center gap-2 mt-2 text-slate-600">
                    <Clock className="w-4 h-4 text-slate-400 shrink-0" />
                    <span className="font-medium">
                      {selectedEvent.isAllDay
                        ? `All Day · ${format(parseISO(selectedEvent.startDate), "PPPP")}`
                        : `${format(parseISO(selectedEvent.startDate), "PPPP · p")} - ${format(
                            parseISO(selectedEvent.endDate),
                            "p"
                          )}`}
                    </span>
                  </div>
                </div>

                {/* Prominent Video Meeting Button */}
                {meeting && (
                  <div className="pt-1">
                    <a
                      href={meeting.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`flex items-center justify-center gap-2.5 w-full py-2.5 px-4 rounded-xl font-semibold text-xs transition-all shadow-sm ${meeting.color}`}
                    >
                      <Video className="w-4 h-4" />
                      <span>Join with {meeting.type}</span>
                      <ExternalLink className="w-3.5 h-3.5 opacity-80" />
                    </a>
                    <div className="mt-1 text-[11px] text-slate-400 text-center truncate">
                      {meeting.url}
                    </div>
                  </div>
                )}

                {/* Location */}
                {selectedEvent.location && (
                  <div className="flex items-start gap-2.5 p-2.5 bg-slate-50 rounded-xl border border-slate-100">
                    <MapPin className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
                    <div className="break-words font-medium text-slate-800">
                      {renderWithLinks(selectedEvent.location)}
                    </div>
                  </div>
                )}

                {/* Attendees */}
                {emailMatches.length > 0 && (
                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 space-y-2">
                    <div className="flex items-center gap-1.5 font-semibold text-slate-700 text-[11px]">
                      <Users className="w-3.5 h-3.5 text-slate-500" />
                      <span>Participants / Attendees ({emailMatches.length})</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {emailMatches.map((email, idx) => (
                        <span
                          key={idx}
                          className="px-2 py-0.5 bg-white border border-slate-200 rounded-md text-[11px] text-slate-700 shadow-2xs font-mono"
                        >
                          {email}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Description with full clickable links */}
                {selectedEvent.description && (
                  <div className="pt-2 border-t border-slate-100 space-y-1.5">
                    <span className="font-semibold text-slate-700 text-[11px]">Description</span>
                    <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 text-slate-700 whitespace-pre-wrap leading-relaxed text-xs">
                      {renderWithLinks(selectedEvent.description)}
                    </div>
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between pt-3 border-t border-slate-100 shrink-0">
                <button
                  onClick={() => handleDeleteEvent(selectedEvent.id)}
                  className="flex items-center gap-1.5 text-xs text-red-600 hover:text-red-700 font-medium px-2 py-1 rounded-lg hover:bg-red-50 transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Delete Event</span>
                </button>

                <button
                  onClick={() => setSelectedEvent(null)}
                  className="px-4 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* CREATE EVENT MODAL */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <form
            onSubmit={handleCreateEvent}
            className="bg-white rounded-xl shadow-2xl border border-slate-200 max-w-md w-full p-5 overflow-hidden animate-in fade-in-50 zoom-in-95"
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-sm font-bold text-slate-900">Create New Event</h3>
              <button
                type="button"
                onClick={() => setIsCreateModalOpen(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 mt-3 text-xs">
              <div>
                <label className="block text-slate-600 font-semibold mb-1">Title *</label>
                <input
                  type="text"
                  required
                  value={newEventSummary}
                  onChange={(e) => setNewEventSummary(e.target.value)}
                  placeholder="Meeting with..."
                  className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {calendars.length > 0 && (
                <div>
                  <label className="block text-slate-600 font-semibold mb-1">Calendar Account *</label>
                  <select
                    value={newEventCalendarId}
                    onChange={(e) => setNewEventCalendarId(e.target.value)}
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white font-medium"
                  >
                    {calendars.map((cal) => {
                      const accountLabel = cal.account?.label || cal.account?.emailAddress || "Account";
                      const isSame = cal.name === accountLabel || cal.name === cal.account?.emailAddress;
                      const label = isSame ? accountLabel : `${accountLabel} (${cal.name})`;

                      return (
                        <option key={cal.id} value={cal.id}>
                          {label}
                        </option>
                      );
                    })}
                  </select>
                </div>
              )}

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-slate-600 font-semibold mb-1">Start *</label>
                  <input
                    type="datetime-local"
                    required
                    value={newEventStartDate}
                    onChange={(e) => setNewEventStartDate(e.target.value)}
                    className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-slate-600 font-semibold mb-1">End *</label>
                  <input
                    type="datetime-local"
                    required
                    value={newEventEndDate}
                    onChange={(e) => setNewEventEndDate(e.target.value)}
                    className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="allDayCheckbox"
                  checked={newEventIsAllDay}
                  onChange={(e) => setNewEventIsAllDay(e.target.checked)}
                  className="rounded text-blue-600 focus:ring-blue-500"
                />
                <label htmlFor="allDayCheckbox" className="text-slate-700 font-medium">
                  All-day event
                </label>
              </div>

              <div>
                <label className="block text-slate-600 font-semibold mb-1">Location</label>
                <input
                  type="text"
                  value={newEventLocation}
                  onChange={(e) => setNewEventLocation(e.target.value)}
                  placeholder="Conference room, Zoom link, or address"
                  className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-slate-600 font-semibold mb-1">Description</label>
                <textarea
                  rows={2}
                  value={newEventDescription}
                  onChange={(e) => setNewEventDescription(e.target.value)}
                  placeholder="Event details, notes..."
                  className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 mt-5 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setIsCreateModalOpen(false)}
                className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSaving}
                className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors shadow-sm disabled:opacity-50"
              >
                {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                <span>Save Event</span>
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

export default CalendarView;
