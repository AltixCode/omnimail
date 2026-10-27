"use client";

import React, { useEffect, useState, useCallback, useRef } from "react";
import {
  format,
  parseISO,
  startOfDay,
  endOfDay,
  addDays,
  subDays,
  isToday,
  isTomorrow,
  isYesterday,
} from "date-fns";
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Clock,
  MapPin,
  Loader2,
  RefreshCw,
  PanelRightClose,
} from "lucide-react";
import { CALENDAR_PALETTE } from "@/lib/calendar-colors";
import { formatTimeDual } from "@/lib/timezone";

interface AgendaEvent {
  id: string;
  calendarId: string;
  summary: string;
  location?: string | null;
  startDate: string;
  endDate: string;
  isAllDay: boolean;
  timezone?: string | null;
  calendar?: {
    id: string;
    name: string;
    color: string;
  };
}

interface TodayAgendaSidebarProps {
  isOpen: boolean;
  onToggle: () => void;
  onSelectEvent?: (date: Date, eventId?: string) => void;
  initialDate?: Date;
}

export function TodayAgendaSidebar({
  isOpen,
  onToggle,
  onSelectEvent,
  initialDate,
}: TodayAgendaSidebarProps) {
  const [currentDate, setCurrentDate] = useState<Date>(initialDate || new Date());
  const [events, setEvents] = useState<AgendaEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const activeDateRef = useRef<string>("");
  const dateInputRef = useRef<HTMLInputElement>(null);

  const getCalColor = (ev: AgendaEvent, idx: number): string => {
    const color = ev.calendar?.color;
    if (color && color !== "#3b82f6") return color;
    return CALENDAR_PALETTE[idx % CALENDAR_PALETTE.length];
  };

  const fetchEventsForDate = useCallback(async (targetDate: Date) => {
    const dateKey = targetDate.toDateString();
    activeDateRef.current = dateKey;

    try {
      setIsLoading(true);
      const start = startOfDay(targetDate).toISOString();
      const end = endOfDay(targetDate).toISOString();
      const res = await fetch(
        `/api/calendar?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`,
      );
      if (res.ok && activeDateRef.current === dateKey) {
        const data = await res.json();
        const dayStart = startOfDay(targetDate);
        const dayEnd = endOfDay(targetDate);
        const dayEvents: AgendaEvent[] = (data.events || []).filter(
          (ev: AgendaEvent) =>
            parseISO(ev.startDate) <= dayEnd &&
            parseISO(ev.endDate) >= dayStart,
        );
        dayEvents.sort(
          (a, b) =>
            new Date(a.startDate).getTime() - new Date(b.startDate).getTime(),
        );
        setEvents(dayEvents);
      }
    } catch (err) {
      if (activeDateRef.current === dateKey) {
        console.error("Failed to load calendar events:", err);
      }
    } finally {
      if (activeDateRef.current === dateKey) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    fetchEventsForDate(currentDate);
  }, [isOpen, currentDate, fetchEventsForDate]);

  const handlePrevDay = () => {
    setCurrentDate((prev) => subDays(prev, 1));
  };

  const handleNextDay = () => {
    setCurrentDate((prev) => addDays(prev, 1));
  };

  const handleToday = () => {
    setCurrentDate(new Date());
  };

  const handleRefresh = () => {
    fetchEventsForDate(currentDate);
  };

  const handleOpenDatePicker = () => {
    const input = dateInputRef.current;
    if (!input) return;
    try {
      if (typeof (input as any).showPicker === "function") {
        (input as any).showPicker();
      } else {
        input.focus();
      }
    } catch {
      input.focus();
    }
  };

  const getHeaderTitle = (date: Date) => {
    if (isToday(date)) return "Today";
    if (isTomorrow(date)) return "Tomorrow";
    if (isYesterday(date)) return "Yesterday";
    return format(date, "EEE, MMM d");
  };

  const getHeaderSubtitle = (date: Date) => {
    if (isToday(date) || isTomorrow(date) || isYesterday(date)) {
      return format(date, "EEEE, MMM d");
    }
    return format(date, "EEEE, yyyy");
  };

  if (!isOpen) {
    return (
      <aside className="w-10 h-full border-l border-slate-200 bg-white flex flex-col items-center py-3 shrink-0">
        <button
          type="button"
          onClick={onToggle}
          className="p-1.5 rounded hover:bg-slate-100 text-slate-500 hover:text-slate-800 transition-colors"
          title="Show calendar agenda"
          aria-label="Show calendar agenda"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <CalendarIcon className="w-4 h-4 text-slate-300 mt-3" />
      </aside>
    );
  }

  const isCurrentToday = isToday(currentDate);

  return (
    <aside className="w-72 h-full border-l border-slate-200 bg-white flex flex-col shrink-0">
      {/* Hidden date picker for direct date jump */}
      <input
        ref={dateInputRef}
        type="date"
        value={format(currentDate, "yyyy-MM-dd")}
        onChange={(e) => {
          if (e.target.value) {
            const [y, m, d] = e.target.value.split("-").map(Number);
            setCurrentDate(new Date(y, m - 1, d, 12, 0, 0));
          }
        }}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
      />

      {/* Header with Title, Navigation & Actions */}
      <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-slate-200 gap-2 select-none">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleOpenDatePicker}
              className="group flex items-center gap-1.5 min-w-0 text-left hover:opacity-80 transition-opacity"
              title="Click to choose a date"
            >
              <CalendarIcon className="w-3.5 h-3.5 text-blue-600 shrink-0" />
              <h3 className="text-xs font-bold text-slate-900 truncate">
                {getHeaderTitle(currentDate)}
              </h3>
            </button>
            {!isCurrentToday && (
              <button
                type="button"
                onClick={handleToday}
                className="text-[10px] font-semibold text-blue-600 bg-blue-50 hover:bg-blue-100 px-1.5 py-0.5 rounded border border-blue-200/70 transition-colors shrink-0"
                title="Jump to Today"
                aria-label="Jump to Today"
              >
                Today
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={handleOpenDatePicker}
            className="text-[11px] text-slate-400 hover:text-slate-600 mt-0.5 truncate block text-left transition-colors"
            title="Click to choose a date"
          >
            {getHeaderSubtitle(currentDate)}
          </button>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {/* Previous / Next Day Steppers */}
          <div className="flex items-center bg-slate-100 p-0.5 rounded-md border border-slate-200">
            <button
              type="button"
              onClick={handlePrevDay}
              className="p-1 rounded hover:bg-white hover:text-slate-900 text-slate-500 hover:shadow-xs transition-all"
              title="Previous day"
              aria-label="Previous day"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={handleNextDay}
              className="p-1 rounded hover:bg-white hover:text-slate-900 text-slate-500 hover:shadow-xs transition-all"
              title="Next day"
              aria-label="Next day"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <button
            type="button"
            onClick={handleRefresh}
            className="p-1.5 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition-colors"
            title="Refresh events"
            aria-label="Refresh events"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${isLoading ? "animate-spin text-blue-500" : ""}`}
            />
          </button>
          <button
            type="button"
            onClick={onToggle}
            className="p-1.5 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition-colors"
            title="Collapse calendar"
            aria-label="Collapse calendar"
          >
            <PanelRightClose className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center h-32 text-slate-400 gap-2">
            <Loader2 className="w-5 h-5 animate-spin text-blue-500" />
            <span className="text-[11px]">Loading events...</span>
          </div>
        ) : events.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-slate-400 gap-1.5 px-4 text-center">
            <CalendarIcon className="w-6 h-6 text-slate-200" />
            <span className="text-[11px]">
              {isCurrentToday
                ? "No events scheduled today"
                : `No events scheduled for ${format(currentDate, "MMM d")}`}
            </span>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {events.map((ev, idx) => {
              const timeInfo = formatTimeDual(
                ev.startDate,
                ev.endDate,
                ev.timezone,
                undefined,
                ev.isAllDay,
              );
              return (
                <button
                  type="button"
                  key={ev.id}
                  onClick={() => onSelectEvent?.(parseISO(ev.startDate), ev.id)}
                  className="w-full text-left px-3.5 py-2.5 hover:bg-slate-50 transition-colors flex items-start gap-2.5"
                >
                  <div
                    className="w-2.5 h-2.5 rounded-full mt-1 shrink-0"
                    style={{ backgroundColor: getCalColor(ev, idx) }}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-slate-900 truncate">
                      {ev.summary || "(No title)"}
                    </p>
                    <p className="flex items-center gap-1 text-[11px] text-slate-500 mt-0.5">
                      <Clock className="w-3 h-3 text-slate-400 shrink-0" />
                      <span className="truncate">{timeInfo.localDisplay}</span>
                    </p>
                    {ev.location && (
                      <p className="flex items-center gap-1 text-[11px] text-slate-400 mt-0.5">
                        <MapPin className="w-3 h-3 shrink-0" />
                        <span className="truncate">{ev.location}</span>
                      </p>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
}
