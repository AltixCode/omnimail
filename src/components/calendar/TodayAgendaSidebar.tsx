"use client";

import React, { useEffect, useState } from "react";
import { format, parseISO, startOfDay, endOfDay } from "date-fns";
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Clock,
  MapPin,
  Loader2,
  RefreshCw,
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
  onSelectEvent?: (date: Date) => void;
}

export function TodayAgendaSidebar({
  isOpen,
  onToggle,
  onSelectEvent,
}: TodayAgendaSidebarProps) {
  const [events, setEvents] = useState<AgendaEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const getCalColor = (ev: AgendaEvent, idx: number): string => {
    const color = ev.calendar?.color;
    if (color && color !== "#3b82f6") return color;
    return CALENDAR_PALETTE[idx % CALENDAR_PALETTE.length];
  };

  const fetchToday = async () => {
    try {
      setIsLoading(true);
      const start = startOfDay(new Date()).toISOString();
      const end = endOfDay(new Date()).toISOString();
      const res = await fetch(
        `/api/calendar?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`,
      );
      if (res.ok) {
        const data = await res.json();
        const todayEvents: AgendaEvent[] = (data.events || []).filter(
          (ev: AgendaEvent) =>
            parseISO(ev.startDate) <= endOfDay(new Date()) &&
            parseISO(ev.endDate) >= startOfDay(new Date()),
        );
        todayEvents.sort(
          (a, b) =>
            new Date(a.startDate).getTime() - new Date(b.startDate).getTime(),
        );
        setEvents(todayEvents);
      }
    } catch (err) {
      console.error("Failed to load today's events:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    fetchToday();
  }, [isOpen]);

  if (!isOpen) {
    return (
      <aside className="w-10 h-full border-l border-slate-200 bg-white flex flex-col items-center py-3 shrink-0">
        <button
          type="button"
          onClick={onToggle}
          className="p-1.5 rounded hover:bg-slate-100 text-slate-500 hover:text-slate-800 transition-colors"
          title="Show today's calendar"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <CalendarIcon className="w-4 h-4 text-slate-300 mt-3" />
      </aside>
    );
  }

  return (
    <aside className="w-72 h-full border-l border-slate-200 bg-white flex flex-col shrink-0">
      <div className="flex items-center justify-between px-3.5 py-3 border-b border-slate-200">
        <div>
          <h3 className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
            <CalendarIcon className="w-3.5 h-3.5 text-blue-600" />
            Today
          </h3>
          <p className="text-[11px] text-slate-400 mt-0.5">
            {format(new Date(), "EEEE, MMM d")}
          </p>
        </div>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={fetchToday}
            className="p-1.5 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition-colors"
            title="Refresh"
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
          >
            <ChevronRight className="w-3.5 h-3.5" />
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
            <span className="text-[11px]">No events scheduled today</span>
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
                  onClick={() => onSelectEvent?.(parseISO(ev.startDate))}
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
