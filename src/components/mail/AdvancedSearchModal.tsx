"use client";

import React, { useState, useEffect } from "react";
import {
  SlidersHorizontal,
  X,
  Search,
  RotateCcw,
  Calendar,
  Paperclip,
  CalendarCheck,
  Check,
} from "lucide-react";
import {
  AdvancedSearchFilters,
  buildSearchQueryString,
  parseSearchQuery,
  formatByteSize,
} from "@/lib/search-query";

interface AdvancedSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentQuery: string;
  onApplySearch: (queryString: string) => void;
  currentView?: string;
}

export function AdvancedSearchModal({
  isOpen,
  onClose,
  currentQuery,
  onApplySearch,
  currentView = "inbox",
}: AdvancedSearchModalProps) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [hasWords, setHasWords] = useState("");
  const [doesntHave, setDoesntHave] = useState("");
  const [hasAttachment, setHasAttachment] = useState(false);
  const [hasInvite, setHasInvite] = useState(false);
  const [filename, setFilename] = useState("");
  const [sizeRelation, setSizeRelation] = useState<"greater" | "less" | "">("");
  const [sizeValue, setSizeValue] = useState<string>("");
  const [sizeUnit, setSizeUnit] = useState<"MB" | "KB" | "Bytes">("MB");
  const [dateWithin, setDateWithin] = useState<string>("");
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  const [readStatus, setReadStatus] = useState<"all" | "unread" | "read">("all");
  const [starredStatus, setStarredStatus] = useState<"all" | "starred" | "unstarred">("all");
  const [inView, setInView] = useState<"all" | "inbox" | "starred" | "sent" | "archive" | "trash">("all");

  // Populate from current search query when modal opens
  useEffect(() => {
    if (isOpen) {
      if (currentQuery.trim()) {
        const parsed = parseSearchQuery(currentQuery);
        setFrom(parsed.from || "");
        setTo(parsed.to || "");
        setSubject(parsed.subject || "");
        setHasWords(parsed.freeWords.join(" "));
        setDoesntHave(parsed.excludeWords.join(" "));
        setHasAttachment(Boolean(parsed.hasAttachment || parsed.filename));
        setHasInvite(Boolean(parsed.hasInvite));
        setFilename(parsed.filename || "");

        if (parsed.minSize !== undefined) {
          setSizeRelation("greater");
          if (parsed.minSize >= 1024 * 1024) {
            setSizeValue(String(Math.round(parsed.minSize / (1024 * 1024))));
            setSizeUnit("MB");
          } else if (parsed.minSize >= 1024) {
            setSizeValue(String(Math.round(parsed.minSize / 1024)));
            setSizeUnit("KB");
          } else {
            setSizeValue(String(parsed.minSize));
            setSizeUnit("Bytes");
          }
        } else if (parsed.maxSize !== undefined) {
          setSizeRelation("less");
          if (parsed.maxSize >= 1024 * 1024) {
            setSizeValue(String(Math.round(parsed.maxSize / (1024 * 1024))));
            setSizeUnit("MB");
          } else if (parsed.maxSize >= 1024) {
            setSizeValue(String(Math.round(parsed.maxSize / 1024)));
            setSizeUnit("KB");
          } else {
            setSizeValue(String(parsed.maxSize));
            setSizeUnit("Bytes");
          }
        } else {
          setSizeRelation("");
          setSizeValue("");
        }

        if (parsed.afterDate) {
          setStartDate(parsed.afterDate.toISOString().slice(0, 10));
        } else {
          setStartDate("");
        }

        if (parsed.beforeDate) {
          setEndDate(parsed.beforeDate.toISOString().slice(0, 10));
        } else {
          setEndDate("");
        }

        if (parsed.isRead === false) setReadStatus("unread");
        else if (parsed.isRead === true) setReadStatus("read");
        else setReadStatus("all");

        if (parsed.isStarred === true) setStarredStatus("starred");
        else setStarredStatus("all");

        if (parsed.inView) {
          setInView(parsed.inView as any);
        } else {
          setInView("all");
        }
      } else {
        // Reset to defaults
        handleReset();
      }
    }
  }, [isOpen, currentQuery]);

  const handleReset = () => {
    setFrom("");
    setTo("");
    setSubject("");
    setHasWords("");
    setDoesntHave("");
    setHasAttachment(false);
    setHasInvite(false);
    setFilename("");
    setSizeRelation("");
    setSizeValue("");
    setSizeUnit("MB");
    setDateWithin("");
    setStartDate("");
    setEndDate("");
    setReadStatus("all");
    setStarredStatus("all");
    setInView("all");
  };

  const handleApply = (e?: React.FormEvent) => {
    if (e) e.preventDefault();

    const filters: AdvancedSearchFilters = {
      from,
      to,
      subject,
      hasWords,
      doesntHave,
      hasAttachment,
      hasInvite,
      filename,
      sizeRelation: sizeRelation || undefined,
      sizeValue: sizeValue || undefined,
      sizeUnit,
      dateWithin: dateWithin || undefined,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      readStatus: readStatus !== "all" ? readStatus : undefined,
      starredStatus: starredStatus !== "all" ? starredStatus : undefined,
      inView: inView !== "all" ? inView : undefined,
    };

    const queryString = buildSearchQueryString(filters);
    onApplySearch(queryString);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-16 bg-slate-900/40 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div
        className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[85vh] animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/70">
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="w-5 h-5 text-blue-600" />
            <h3 className="text-sm font-bold text-slate-800">Advanced Search</h3>
            <span className="text-xs text-slate-400 font-normal">Gmail-grade search operators</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200/60 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleApply} className="p-6 overflow-y-auto space-y-4 text-xs">
          {/* Row 1: From & To */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">From</label>
              <input
                type="text"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                placeholder="Sender name or email (e.g. alex@example.com)"
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">To</label>
              <input
                type="text"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                placeholder="Recipient email address"
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
              />
            </div>
          </div>

          {/* Row 2: Subject */}
          <div>
            <label className="block font-semibold text-slate-700 mb-1">Subject</label>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Keywords in subject line"
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
            />
          </div>

          {/* Row 3: Has the words & Doesn't have */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Has the words</label>
              <input
                type="text"
                value={hasWords}
                onChange={(e) => setHasWords(e.target.value)}
                placeholder="Words anywhere in email body"
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Doesn't have</label>
              <input
                type="text"
                value={doesntHave}
                onChange={(e) => setDoesntHave(e.target.value)}
                placeholder="Words to exclude (-word)"
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
              />
            </div>
          </div>

          {/* Row 4: Size */}
          <div>
            <label className="block font-semibold text-slate-700 mb-1">Attachment Size</label>
            <div className="grid grid-cols-3 gap-2">
              <select
                value={sizeRelation}
                onChange={(e) => setSizeRelation(e.target.value as any)}
                className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
              >
                <option value="">Any size</option>
                <option value="greater">Greater than</option>
                <option value="less">Less than</option>
              </select>
              <input
                type="number"
                min="0"
                step="any"
                value={sizeValue}
                onChange={(e) => setSizeValue(e.target.value)}
                disabled={!sizeRelation}
                placeholder="e.g. 5"
                className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
              />
              <select
                value={sizeUnit}
                onChange={(e) => setSizeUnit(e.target.value as any)}
                disabled={!sizeRelation}
                className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
              >
                <option value="MB">MB</option>
                <option value="KB">KB</option>
                <option value="Bytes">Bytes</option>
              </select>
            </div>
          </div>

          {/* Row 5: Date Range */}
          <div>
            <label className="block font-semibold text-slate-700 mb-1">Date Sent</label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <select
                value={dateWithin}
                onChange={(e) => setDateWithin(e.target.value)}
                className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
              >
                <option value="">Any time</option>
                <option value="1d">Past 24 hours</option>
                <option value="3d">Past 3 days</option>
                <option value="7d">Past 1 week</option>
                <option value="14d">Past 2 weeks</option>
                <option value="1m">Past 1 month</option>
                <option value="6m">Past 6 months</option>
                <option value="1y">Past 1 year</option>
                <option value="custom">Custom Date Range</option>
              </select>

              <div className="sm:col-span-2 grid grid-cols-2 gap-2">
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => {
                    setStartDate(e.target.value);
                    setDateWithin("custom");
                  }}
                  title="After date"
                  placeholder="After date"
                  className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                />
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => {
                    setEndDate(e.target.value);
                    setDateWithin("custom");
                  }}
                  title="Before date"
                  placeholder="Before date"
                  className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                />
              </div>
            </div>
          </div>

          {/* Row 6: Location / Search In */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Search In</label>
              <select
                value={inView}
                onChange={(e) => setInView(e.target.value as any)}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
              >
                <option value="all">All Mail (Unified)</option>
                <option value="inbox">Inbox</option>
                <option value="starred">Starred</option>
                <option value="sent">Sent</option>
                <option value="archive">Archive</option>
                <option value="trash">Trash</option>
              </select>
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Read Status</label>
              <select
                value={readStatus}
                onChange={(e) => setReadStatus(e.target.value as any)}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
              >
                <option value="all">All</option>
                <option value="unread">Unread only</option>
                <option value="read">Read only</option>
              </select>
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Starred Status</label>
              <select
                value={starredStatus}
                onChange={(e) => setStarredStatus(e.target.value as any)}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
              >
                <option value="all">All</option>
                <option value="starred">Starred only</option>
              </select>
            </div>
          </div>

          {/* Row 7: Checkboxes (Has Attachment, Has Invite, Specific Filename) */}
          <div className="pt-2 border-t border-slate-100 space-y-2">
            <div className="flex flex-wrap items-center gap-6">
              <label className="flex items-center gap-2 cursor-pointer select-none text-slate-700 font-medium">
                <input
                  type="checkbox"
                  checked={hasAttachment}
                  onChange={(e) => setHasAttachment(e.target.checked)}
                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 w-4 h-4"
                />
                <Paperclip className="w-3.5 h-3.5 text-slate-500" />
                <span>Has attachment</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer select-none text-slate-700 font-medium">
                <input
                  type="checkbox"
                  checked={hasInvite}
                  onChange={(e) => setHasInvite(e.target.checked)}
                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 w-4 h-4"
                />
                <CalendarCheck className="w-3.5 h-3.5 text-blue-600" />
                <span>Has calendar invite</span>
              </label>
            </div>

            {hasAttachment && (
              <div className="pt-1">
                <input
                  type="text"
                  value={filename}
                  onChange={(e) => setFilename(e.target.value)}
                  placeholder="Specific filename or extension (e.g. invoice.pdf or pdf)"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                />
              </div>
            )}
          </div>
        </form>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-100 bg-slate-50/70">
          <button
            type="button"
            onClick={handleReset}
            className="flex items-center gap-1.5 px-3 py-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-200/50 rounded-lg text-xs font-semibold transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-semibold transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => handleApply()}
              className="flex items-center gap-1.5 px-5 py-2 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white rounded-lg text-xs font-semibold shadow-xs transition-colors"
            >
              <Search className="w-3.5 h-3.5" />
              <span>Search</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
