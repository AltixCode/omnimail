"use client";

import React, { useState, useEffect, useCallback, useMemo } from "react";
import { format, isToday, isYesterday, parseISO } from "date-fns";
import {
  Mail,
  Inbox,
  Star,
  Send,
  Archive,
  Trash2,
  Calendar as CalendarIcon,
  Search,
  Plus,
  Settings,
  RefreshCw,
  Paperclip,
  Check,
  CheckCheck,
  ChevronRight,
  ChevronDown,
  Bell,
  BellOff,
  Reply,
  ReplyAll,
  Forward,
  Eye,
  Shield,
  ShieldAlert,
  Loader2,
  Folder as FolderIcon,
  Circle,
  Menu,
  Download,
  AlertCircle,
  Filter,
  LogOut,
  X,
} from "lucide-react";

import { MailRenderer } from "@/components/mail/MailRenderer";
import { MailComposer } from "@/components/mail/MailComposer";
import { CalendarView } from "@/components/calendar/CalendarView";
import { AccountModal } from "@/components/accounts/AccountModal";
import { AuthScreen } from "@/components/auth/AuthScreen";
import { useLiveStream } from "@/hooks/useLiveStream";
import { ErrorBoundary } from "@/components/common/ErrorBoundary";

interface Account {
  id: string;
  label: string;
  emailAddress: string;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  caldavUrl?: string | null;
  syncActive: boolean;
  syncStatus?: string | null;
  lastSyncAt?: string | null;
  folders?: FolderItem[];
}

interface FolderItem {
  id: string;
  accountId: string;
  name: string;
  path: string;
  specialUse?: string | null;
  unreadCount: number;
  totalCount: number;
}

interface MessageListItem {
  id: string;
  accountId: string;
  folderId: string;
  uid: number;
  messageId?: string | null;
  threadId?: string | null;
  fromAddress: string;
  fromName?: string | null;
  toAddresses: string;
  subject?: string | null;
  date: string;
  snippet?: string | null;
  isRead: boolean;
  isStarred: boolean;
  hasAttachments: boolean;
  account: {
    label: string;
    emailAddress: string;
  };
  folder: {
    name: string;
    specialUse?: string | null;
  };
}

interface FullMessage extends MessageListItem {
  ccAddresses?: string | null;
  bccAddresses?: string | null;
  replyTo?: string | null;
  bodyText?: string | null;
  bodyHtml?: string | null;
  attachments?: Array<{
    id: string;
    filename: string;
    contentType: string;
    size: number;
    contentId?: string | null;
    dataBase64?: string | null;
  }>;
}

export default function OmniMailApp() {
  // Navigation & View Mode
  const [currentTab, setCurrentTab] = useState<"mail" | "calendar">("mail");
  const [currentView, setCurrentView] = useState<"inbox" | "starred" | "sent" | "archive" | "trash" | "folder">("inbox");
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null); // null = All Inboxes / Unified
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);

  // Filter & Search
  const [filterMode, setFilterMode] = useState<"all" | "unread" | "starred" | "attachments">("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [debouncedSearch, setDebouncedSearch] = useState<string>("");

  // Data
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [unifiedCounts, setUnifiedCounts] = useState<{ inboxUnread: number; starred: number }>({
    inboxUnread: 0,
    starred: 0,
  });
  const [messages, setMessages] = useState<MessageListItem[]>([]);
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);
  const [fullMessage, setFullMessage] = useState<FullMessage | null>(null);

  // States
  const [isLoadingMessages, setIsLoadingMessages] = useState<boolean>(true);
  const [isLoadingDetail, setIsLoadingDetail] = useState<boolean>(false);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [loadRemoteImages, setLoadRemoteImages] = useState<boolean>(false);

  // Composer State
  const [isComposerOpen, setIsComposerOpen] = useState<boolean>(false);
  const [composerMode, setComposerMode] = useState<"new" | "reply" | "reply-all" | "forward">("new");

  // Account Modal
  const [isAccountModalOpen, setIsAccountModalOpen] = useState<boolean>(false);
  const [accountModalTab, setAccountModalTab] = useState<"list" | "add" | "notifications">("list");
  const [notifBannerDismissed, setNotifBannerDismissed] = useState<boolean>(() => {
    if (typeof window !== "undefined") {
      return sessionStorage.getItem("omnimail_notif_banner_dismissed") === "true";
    }
    return false;
  });

  // Quick reply input
  const [quickReplyText, setQuickReplyText] = useState<string>("");
  const [isSendingQuickReply, setIsSendingQuickReply] = useState<boolean>(false);

  // Expandable account folders in sidebar
  const [expandedAccounts, setExpandedAccounts] = useState<Record<string, boolean>>({});

  // Authentication State
  const [authChecked, setAuthChecked] = useState<boolean>(false);
  const [currentUser, setCurrentUser] = useState<{ id: string; email: string; name?: string | null } | null>(null);
  const [setupRequired, setSetupRequired] = useState<boolean>(false);

  const checkAuth = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/me");
      if (res.ok) {
        const data = await res.json();
        setSetupRequired(Boolean(data.setupRequired));
        if (data.authenticated && data.user) {
          setCurrentUser(data.user);
        } else {
          setCurrentUser(null);
        }
      }
    } catch (err) {
      console.error("Error checking auth:", err);
    } finally {
      setAuthChecked(true);
    }
  }, []);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    setCurrentUser(null);
    checkAuth();
  };

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Load Accounts & Folders
  const loadAccountsAndFolders = useCallback(async () => {
    try {
      const [accRes, foldRes] = await Promise.all([
        fetch("/api/accounts"),
        fetch("/api/folders"),
      ]);

      if (accRes.ok) {
        const accData = await accRes.json();
        setAccounts(accData.accounts || []);
      }

      if (foldRes.ok) {
        const foldData = await foldRes.json();
        if (foldData.accounts) {
          const allFolds = foldData.accounts.flatMap((a: any) => a.folders || []);
          setFolders(allFolds);
        }
        if (foldData.unifiedCounts) {
          setUnifiedCounts(foldData.unifiedCounts);
        }
      }
    } catch (err) {
      console.error("Error loading accounts/folders:", err);
    }
  }, []);

  useEffect(() => {
    loadAccountsAndFolders();
  }, [loadAccountsAndFolders]);

  // Load Messages
  const loadMessages = useCallback(async () => {
    setIsLoadingMessages(true);
    try {
      const params = new URLSearchParams();
      if (selectedAccountId) params.append("accountId", selectedAccountId);
      if (selectedFolderId) {
        params.append("folderId", selectedFolderId);
      } else {
        params.append("view", currentView);
      }

      if (filterMode === "unread") params.append("unreadOnly", "true");
      if (filterMode === "starred") params.append("starredOnly", "true");
      if (filterMode === "attachments") params.append("hasAttachments", "true");
      if (debouncedSearch) params.append("query", debouncedSearch);

      const res = await fetch(`/api/messages?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setMessages(data.messages || []);

        // Auto select first message if none selected
        if (data.messages && data.messages.length > 0 && !selectedMessageId) {
          setSelectedMessageId(data.messages[0].id);
        }
      }
    } catch (err) {
      console.error("Error loading messages:", err);
    } finally {
      setIsLoadingMessages(false);
    }
  }, [selectedAccountId, selectedFolderId, currentView, filterMode, debouncedSearch, selectedMessageId]);

  useEffect(() => {
    loadMessages();
  }, [loadMessages]);

  // Load Full Message Detail
  useEffect(() => {
    if (!selectedMessageId) {
      setFullMessage(null);
      return;
    }

    let isSubscribed = true;
    setIsLoadingDetail(true);
    setLoadRemoteImages(false);

    fetch(`/api/messages/${selectedMessageId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!isSubscribed) return;
        if (data?.message) {
          setFullMessage(data.message);
          // Mark as read if not already
          if (!data.message.isRead) {
            fetch(`/api/messages/${selectedMessageId}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ isRead: true }),
            });
            // Update in local message list
            setMessages((prev) =>
              prev.map((m) => (m.id === selectedMessageId ? { ...m, isRead: true } : m))
            );
          }
        }
      })
      .catch((err) => console.error("Error loading full message:", err))
      .finally(() => {
        if (isSubscribed) setIsLoadingDetail(false);
      });

    return () => {
      isSubscribed = false;
    };
  }, [selectedMessageId]);

  // Real-Time Live Stream SSE Integration
  const { isConnected, notificationPermission, requestNotificationPermission } = useLiveStream({
    onNewMessage: (data) => {
      // Refresh folder counts and messages cleanly from API
      loadAccountsAndFolders();
      loadMessages();
    },
    onMessageUpdated: (data) => {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === data.id
            ? {
                ...m,
                isRead: data.isRead !== undefined ? data.isRead : m.isRead,
                isStarred: data.isStarred !== undefined ? data.isStarred : m.isStarred,
              }
            : m
        )
      );
      if (fullMessage?.id === data.id) {
        setFullMessage((prev) =>
          prev
            ? {
                ...prev,
                isRead: data.isRead !== undefined ? data.isRead : prev.isRead,
                isStarred: data.isStarred !== undefined ? data.isStarred : prev.isStarred,
              }
            : null
        );
      }
    },
    onMessageDeleted: (data) => {
      setMessages((prev) => prev.filter((m) => m.id !== data.id));
      if (selectedMessageId === data.id) {
        setSelectedMessageId(null);
        setFullMessage(null);
      }
      loadAccountsAndFolders();
    },
    onFolderUpdated: () => {
      loadAccountsAndFolders();
    },
    onSyncStatus: (data) => {
      if (data?.status === "syncing") {
        setIsSyncing(true);
      } else {
        setIsSyncing(false);
        loadAccountsAndFolders();
      }
    },
  });

  // Dynamic Browser Tab Title with unread counter
  useEffect(() => {
    const unread = unifiedCounts.inboxUnread;
    if (unread > 0) {
      document.title = `(${unread}) OmniMail — Unified Webmail & CalDAV Client`;
    } else {
      document.title = "OmniMail — Unified Webmail & CalDAV Client";
    }
  }, [unifiedCounts.inboxUnread]);

  // Manual Refresh / Sync
  const handleTriggerSync = async () => {
    setIsSyncing(true);
    try {
      await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId: selectedAccountId || undefined }),
      });
      await Promise.all([loadAccountsAndFolders(), loadMessages()]);
    } catch (err) {
      console.error("Error running sync:", err);
    } finally {
      setIsSyncing(false);
    }
  };

  // Toggle Star on Message
  const handleToggleStar = async (msgId: string, currentVal: boolean, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const newVal = !currentVal;

    // Optimistic update
    setMessages((prev) =>
      prev.map((m) => (m.id === msgId ? { ...m, isStarred: newVal } : m))
    );
    if (fullMessage?.id === msgId) {
      setFullMessage((prev) => (prev ? { ...prev, isStarred: newVal } : null));
    }

    try {
      await fetch(`/api/messages/${msgId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isStarred: newVal }),
      });
    } catch (err) {
      console.error("Error toggling star:", err);
    }
  };

  // Toggle Read / Unread
  const handleToggleRead = async (msgId: string, currentVal: boolean) => {
    const newVal = !currentVal;
    setMessages((prev) =>
      prev.map((m) => (m.id === msgId ? { ...m, isRead: newVal } : m))
    );
    if (fullMessage?.id === msgId) {
      setFullMessage((prev) => (prev ? { ...prev, isRead: newVal } : null));
    }

    try {
      await fetch(`/api/messages/${msgId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isRead: newVal }),
      });
      loadAccountsAndFolders();
    } catch (err) {
      console.error("Error toggling read:", err);
    }
  };

  // Move Message to Trash / Delete
  const handleDeleteMessage = async (msgId: string) => {
    try {
      await fetch(`/api/messages/${msgId}`, { method: "DELETE" });
      setMessages((prev) => prev.filter((m) => m.id !== msgId));
      if (selectedMessageId === msgId) {
        setSelectedMessageId(null);
        setFullMessage(null);
      }
      loadAccountsAndFolders();
    } catch (err) {
      console.error("Error deleting message:", err);
    }
  };

  // Quick Reply handler
  const handleSendQuickReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickReplyText.trim() || !fullMessage) return;

    setIsSendingQuickReply(true);
    try {
      const res = await fetch("/api/messages/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId: fullMessage.accountId,
          to: [fullMessage.fromAddress],
          subject: fullMessage.subject?.toLowerCase().startsWith("re:")
            ? fullMessage.subject
            : `Re: ${fullMessage.subject || ""}`,
          bodyText: quickReplyText,
          inReplyTo: fullMessage.messageId || undefined,
        }),
      });

      if (res.ok) {
        setQuickReplyText("");
        alert("Reply sent successfully!");
      } else {
        const data = await res.json();
        alert("Failed to send: " + (data.error || "Unknown error"));
      }
    } catch (err: any) {
      alert("Error sending quick reply: " + err.message);
    } finally {
      setIsSendingQuickReply(false);
    }
  };

  const formatMessageDate = (dateStr: string) => {
    try {
      const d = parseISO(dateStr);
      if (isToday(d)) return format(d, "HH:mm");
      if (isYesterday(d)) return "Yesterday";
      return format(d, "MMM d");
    } catch {
      return dateStr;
    }
  };

  const toggleAccountExpand = (accId: string) => {
    setExpandedAccounts((prev) => ({ ...prev, [accId]: !prev[accId] }));
  };

  if (!authChecked) {
    return (
      <div className="min-h-screen w-screen bg-slate-950 flex flex-col items-center justify-center text-slate-400 gap-3 select-none">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
        <span className="text-xs font-medium tracking-wide">Starting OmniMail...</span>
      </div>
    );
  }

  if (!currentUser) {
    return <AuthScreen isSetup={setupRequired} onSuccess={() => checkAuth()} />;
  }

  return (
    <ErrorBoundary>
      <div className="flex h-screen w-screen overflow-hidden bg-slate-900 text-slate-100 select-none">
      {/* ========================================================================= */}
      {/* 1. LEFT PANE / SIDEBAR NAVIGATION */}
      {/* ========================================================================= */}
      <aside className="w-64 bg-slate-900 border-r border-slate-800 flex flex-col shrink-0">
        {/* Top App Title & Real-time Live Status */}
        <div className="flex items-center justify-between px-4 py-3.5 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center text-white shadow-sm font-bold text-xs tracking-wider">
              OM
            </div>
            <div>
              <h1 className="text-sm font-bold text-white tracking-tight flex items-center gap-1.5">
                OmniMail
              </h1>
              <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    isConnected ? "bg-emerald-500 animate-pulse" : "bg-amber-500"
                  }`}
                />
                <span>{isConnected ? "Live Stream" : "Connecting..."}</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={() => {
                setAccountModalTab("notifications");
                setIsAccountModalOpen(true);
              }}
              className={`p-1.5 rounded transition-colors ${
                notificationPermission === "granted"
                  ? "text-emerald-400 hover:bg-slate-800"
                  : "text-amber-400 hover:bg-slate-800"
              }`}
              title={
                notificationPermission === "granted"
                  ? "Desktop notifications active (Click to manage)"
                  : "Enable desktop notifications (Click to configure)"
              }
            >
              {notificationPermission === "granted" ? (
                <Bell className="w-4 h-4" />
              ) : (
                <BellOff className="w-4 h-4" />
              )}
            </button>

            <button
              onClick={() => {
                setAccountModalTab("list");
                setIsAccountModalOpen(true);
              }}
              className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
              title="Settings & Accounts"
            >
              <Settings className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Compose Button */}
        <div className="p-3">
          <button
            onClick={() => {
              setComposerMode("new");
              setIsComposerOpen(true);
            }}
            className="w-full flex items-center justify-center gap-2 py-2 px-4 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold shadow-md transition-all active:scale-[0.98]"
          >
            <Plus className="w-4 h-4" />
            <span>New Message</span>
          </button>
        </div>

        {/* Navigation Views */}
        <div className="flex-1 overflow-y-auto px-2 space-y-5 text-xs">
          {/* Main Views */}
          <div className="space-y-0.5">
            <button
              onClick={() => {
                setCurrentTab("mail");
                setCurrentView("inbox");
                setSelectedFolderId(null);
              }}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-lg font-medium transition-colors ${
                currentTab === "mail" && currentView === "inbox" && !selectedFolderId
                  ? "bg-slate-800 text-white shadow-xs"
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
              }`}
            >
              <div className="flex items-center gap-2.5">
                <Inbox className="w-4 h-4 text-blue-400" />
                <span>All Inboxes</span>
              </div>
              {unifiedCounts.inboxUnread > 0 && (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-600 text-white">
                  {unifiedCounts.inboxUnread}
                </span>
              )}
            </button>

            <button
              onClick={() => {
                setCurrentTab("mail");
                setCurrentView("starred");
                setSelectedFolderId(null);
              }}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-lg font-medium transition-colors ${
                currentTab === "mail" && currentView === "starred"
                  ? "bg-slate-800 text-white"
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
              }`}
            >
              <div className="flex items-center gap-2.5">
                <Star className="w-4 h-4 text-amber-400" />
                <span>Starred</span>
              </div>
              {unifiedCounts.starred > 0 && (
                <span className="text-[11px] text-slate-400">{unifiedCounts.starred}</span>
              )}
            </button>

            <button
              onClick={() => {
                setCurrentTab("mail");
                setCurrentView("sent");
                setSelectedFolderId(null);
              }}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-lg font-medium transition-colors ${
                currentTab === "mail" && currentView === "sent"
                  ? "bg-slate-800 text-white"
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
              }`}
            >
              <div className="flex items-center gap-2.5">
                <Send className="w-4 h-4 text-emerald-400" />
                <span>Sent</span>
              </div>
            </button>

            <button
              onClick={() => {
                setCurrentTab("mail");
                setCurrentView("archive");
                setSelectedFolderId(null);
              }}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-lg font-medium transition-colors ${
                currentTab === "mail" && currentView === "archive"
                  ? "bg-slate-800 text-white"
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
              }`}
            >
              <div className="flex items-center gap-2.5">
                <Archive className="w-4 h-4 text-purple-400" />
                <span>Archive</span>
              </div>
            </button>

            <button
              onClick={() => {
                setCurrentTab("mail");
                setCurrentView("trash");
                setSelectedFolderId(null);
              }}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-lg font-medium transition-colors ${
                currentTab === "mail" && currentView === "trash"
                  ? "bg-slate-800 text-white"
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
              }`}
            >
              <div className="flex items-center gap-2.5">
                <Trash2 className="w-4 h-4 text-rose-400" />
                <span>Trash</span>
              </div>
            </button>
          </div>

          {/* Calendar App Switcher */}
          <div>
            <div className="px-3 pb-1 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
              Apps
            </div>
            <button
              onClick={() => setCurrentTab("calendar")}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-lg font-medium transition-colors ${
                currentTab === "calendar"
                  ? "bg-slate-800 text-white"
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
              }`}
            >
              <div className="flex items-center gap-2.5">
                <CalendarIcon className="w-4 h-4 text-sky-400" />
                <span>Calendar & CalDAV</span>
              </div>
            </button>
          </div>

          {/* Accounts & Folders Tree */}
          <div className="space-y-1">
            <div className="flex items-center justify-between px-3 pb-1 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
              <span>Mail Accounts</span>
              <button
                onClick={() => setIsAccountModalOpen(true)}
                className="hover:text-white"
                title="Add Account"
              >
                <Plus className="w-3 h-3" />
              </button>
            </div>

            {accounts.map((acc) => {
              const accFolders = folders.filter((f) => f.accountId === acc.id);
              const isExpanded = expandedAccounts[acc.id] ?? true;

              return (
                <div key={acc.id} className="space-y-0.5">
                  <div
                    onClick={() => toggleAccountExpand(acc.id)}
                    className="flex items-center justify-between px-2 py-1.5 rounded hover:bg-slate-800/50 cursor-pointer text-slate-300 font-medium"
                  >
                    <div className="flex items-center gap-1.5 truncate">
                      {isExpanded ? (
                        <ChevronDown className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                      ) : (
                        <ChevronRight className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                      )}
                      <span className="truncate">{acc.label}</span>
                    </div>
                    {acc.syncStatus === "syncing" && (
                      <RefreshCw className="w-3 h-3 animate-spin text-blue-400 shrink-0" />
                    )}
                  </div>

                  {isExpanded && (
                    <div className="pl-5 space-y-0.5 border-l border-slate-800 ml-3">
                      {accFolders.map((f) => {
                        const isSelected = selectedFolderId === f.id;
                        return (
                          <button
                            key={f.id}
                            onClick={() => {
                              setCurrentTab("mail");
                              setSelectedAccountId(acc.id);
                              setSelectedFolderId(f.id);
                            }}
                            className={`w-full flex items-center justify-between px-2 py-1 rounded text-[11px] transition-colors ${
                              isSelected
                                ? "bg-slate-800 text-white font-semibold"
                                : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/30"
                            }`}
                          >
                            <span className="truncate">{f.name}</span>
                            {f.unreadCount > 0 && (
                              <span className="px-1.5 py-0.2 rounded-full text-[9px] font-bold bg-blue-600 text-white">
                                {f.unreadCount}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Bottom User Bar */}
        <div className="p-3 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
          <div className="flex items-center gap-2.5 truncate">
            <div className="w-7 h-7 rounded-full bg-blue-600/30 border border-blue-500/40 flex items-center justify-center font-bold text-blue-400 text-xs shrink-0">
              {currentUser?.name?.[0]?.toUpperCase() || currentUser?.email?.[0]?.toUpperCase() || "A"}
            </div>
            <div className="truncate">
              <div className="text-slate-200 font-semibold truncate text-[11px] leading-tight">
                {currentUser?.name || currentUser?.email}
              </div>
              <div className="text-[10px] text-slate-500 truncate leading-tight">
                {accounts.length} {accounts.length === 1 ? "account" : "accounts"}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={handleTriggerSync}
              disabled={isSyncing}
              className="p-1.5 rounded hover:bg-slate-800 hover:text-white transition-colors"
              title="Trigger full sync"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? "animate-spin text-blue-400" : ""}`} />
            </button>
            <button
              onClick={handleLogout}
              className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-rose-400 transition-colors"
              title="Sign out"
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </aside>

      {/* ========================================================================= */}
      {/* 2. CALENDAR VIEW OR EMAIL SPLIT PANE */}
      {/* ========================================================================= */}
      {currentTab === "calendar" ? (
        <main className="flex-1 h-full overflow-hidden bg-white text-slate-800">
          <CalendarView onRefreshTrigger={loadAccountsAndFolders} />
        </main>
      ) : (
        <main className="flex-1 flex h-full overflow-hidden bg-slate-50 text-slate-800">
          {/* ===================================================================== */}
          {/* MIDDLE PANE: MESSAGE LIST */}
          {/* ===================================================================== */}
          <div className="w-96 border-r border-slate-200 bg-white flex flex-col shrink-0">
            {/* Desktop Notification Enable Banner */}
            {notificationPermission === "default" && !notifBannerDismissed && (
              <div className="bg-gradient-to-r from-blue-700 via-indigo-600 to-blue-600 text-white p-3 text-xs flex items-center justify-between border-b border-blue-800 shadow-xs animate-in fade-in-50">
                <div className="flex items-center gap-2 pr-2 min-w-0">
                  <Bell className="w-4 h-4 shrink-0 text-blue-200 animate-bounce" />
                  <span className="font-medium text-[11px] leading-snug">
                    Enable desktop alerts for instant notifications when new emails arrive.
                  </span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={async () => {
                      const granted = await requestNotificationPermission();
                      if (!granted) {
                        setAccountModalTab("notifications");
                        setIsAccountModalOpen(true);
                      }
                    }}
                    className="px-2.5 py-1 bg-white text-blue-700 font-bold rounded text-[11px] hover:bg-blue-50 transition-colors shadow-2xs"
                  >
                    Enable
                  </button>
                  <button
                    onClick={() => {
                      setNotifBannerDismissed(true);
                      sessionStorage.setItem("omnimail_notif_banner_dismissed", "true");
                    }}
                    className="p-1 text-blue-200 hover:text-white rounded transition-colors"
                    title="Dismiss"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}

            {/* Search Header */}
            <div className="p-3 border-b border-slate-200 space-y-2.5">
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search subject, sender, body..."
                  className="w-full pl-9 pr-8 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery("")}
                    className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600"
                  >
                    ×
                  </button>
                )}
              </div>

              {/* Filter tabs */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-lg text-[11px] font-medium">
                  <button
                    onClick={() => setFilterMode("all")}
                    className={`px-2.5 py-1 rounded-md transition-colors ${
                      filterMode === "all"
                        ? "bg-white text-slate-900 shadow-xs font-semibold"
                        : "text-slate-500 hover:text-slate-800"
                    }`}
                  >
                    All
                  </button>
                  <button
                    onClick={() => setFilterMode("unread")}
                    className={`px-2.5 py-1 rounded-md transition-colors ${
                      filterMode === "unread"
                        ? "bg-white text-slate-900 shadow-xs font-semibold"
                        : "text-slate-500 hover:text-slate-800"
                    }`}
                  >
                    Unread
                  </button>
                  <button
                    onClick={() => setFilterMode("starred")}
                    className={`px-2.5 py-1 rounded-md transition-colors ${
                      filterMode === "starred"
                        ? "bg-white text-slate-900 shadow-xs font-semibold"
                        : "text-slate-500 hover:text-slate-800"
                    }`}
                  >
                    Starred
                  </button>
                  <button
                    onClick={() => setFilterMode("attachments")}
                    className={`px-2.5 py-1 rounded-md transition-colors ${
                      filterMode === "attachments"
                        ? "bg-white text-slate-900 shadow-xs font-semibold"
                        : "text-slate-500 hover:text-slate-800"
                    }`}
                  >
                    Files
                  </button>
                </div>

                <button
                  onClick={handleTriggerSync}
                  className="p-1 text-slate-400 hover:text-slate-600 rounded transition-colors"
                  title="Refresh messages"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? "animate-spin text-blue-600" : ""}`} />
                </button>
              </div>
            </div>

            {/* Message Cards List */}
            <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
              {isLoadingMessages ? (
                <div className="flex flex-col items-center justify-center h-48 text-slate-400 gap-2">
                  <Loader2 className="w-5 h-5 animate-spin text-blue-600" />
                  <span className="text-xs">Loading messages...</span>
                </div>
              ) : messages.length === 0 ? (
                <div className="py-16 px-4 text-center">
                  <Mail className="w-10 h-10 text-slate-300 mx-auto mb-2" />
                  <p className="text-xs font-semibold text-slate-600">No messages found</p>
                  <p className="text-[11px] text-slate-400 mt-1">
                    {searchQuery ? "Try a different search term" : "Your mailbox is all caught up."}
                  </p>
                </div>
              ) : (
                messages.map((msg) => {
                  const isSelected = selectedMessageId === msg.id;
                  return (
                    <div
                      key={msg.id}
                      onClick={() => setSelectedMessageId(msg.id)}
                      className={`p-3.5 cursor-pointer transition-colors relative flex flex-col gap-1 ${
                        isSelected
                          ? "bg-blue-50/70 border-l-[3px] border-blue-600"
                          : !msg.isRead
                          ? "bg-slate-50/60 hover:bg-slate-100/70"
                          : "bg-white hover:bg-slate-50"
                      }`}
                    >
                      {/* Sender and Date */}
                      <div className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-1.5 truncate">
                          {!msg.isRead && (
                            <Circle className="w-2 h-2 fill-blue-600 text-blue-600 shrink-0" />
                          )}
                          <span
                            className={`truncate ${
                              !msg.isRead ? "font-bold text-slate-900" : "font-medium text-slate-700"
                            }`}
                          >
                            {msg.fromName || msg.fromAddress}
                          </span>
                        </div>
                        <span className="text-[11px] text-slate-400 shrink-0">
                          {formatMessageDate(msg.date)}
                        </span>
                      </div>

                      {/* Subject */}
                      <div className="flex items-center justify-between gap-2">
                        <h4
                          className={`text-xs truncate ${
                            !msg.isRead ? "font-bold text-slate-900" : "font-semibold text-slate-800"
                          }`}
                        >
                          {msg.subject || "(No Subject)"}
                        </h4>
                        <button
                          type="button"
                          onClick={(e) => handleToggleStar(msg.id, msg.isStarred, e)}
                          className="text-slate-300 hover:text-amber-400 transition-colors shrink-0"
                        >
                          <Star
                            className={`w-3.5 h-3.5 ${
                              msg.isStarred ? "text-amber-400 fill-amber-400" : ""
                            }`}
                          />
                        </button>
                      </div>

                      {/* Snippet */}
                      <p className="text-[11px] text-slate-500 line-clamp-2 leading-relaxed">
                        {msg.snippet || "(No content)"}
                      </p>

                      {/* Meta badges (Attachments, Account) */}
                      <div className="flex items-center gap-2 mt-1">
                        {msg.hasAttachments && (
                          <span className="flex items-center gap-0.5 text-[10px] text-slate-500 font-medium bg-slate-100 px-1.5 py-0.5 rounded">
                            <Paperclip className="w-2.5 h-2.5" />
                            <span>Attachment</span>
                          </span>
                        )}
                        {!selectedAccountId && (
                          <span className="text-[10px] text-slate-400 truncate max-w-[120px]">
                            {msg.account?.label || msg.account?.emailAddress || ""}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* ===================================================================== */}
          {/* RIGHT PANE: MESSAGE DETAIL & COMPOSER */}
          {/* ===================================================================== */}
          <div className="flex-1 flex flex-col bg-white overflow-hidden">
            {isComposerOpen ? (
              <div className="h-full p-4 bg-slate-50">
                <MailComposer
                  accounts={accounts}
                  defaultAccountId={selectedAccountId || accounts[0]?.id}
                  replyToMessage={composerMode !== "new" ? fullMessage : null}
                  mode={composerMode}
                  onClose={() => setIsComposerOpen(false)}
                  onSent={() => {
                    loadMessages();
                    loadAccountsAndFolders();
                  }}
                />
              </div>
            ) : !selectedMessageId ? (
              <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-3">
                <Mail className="w-12 h-12 text-slate-200 stroke-1" />
                <p className="text-sm font-medium text-slate-500">Select an email to read</p>
                <button
                  onClick={() => setIsComposerOpen(true)}
                  className="px-3.5 py-1.5 text-xs font-semibold text-blue-600 border border-blue-200 hover:bg-blue-50 rounded-lg transition-colors"
                >
                  Compose a new email
                </button>
              </div>
            ) : isLoadingDetail || !fullMessage ? (
              <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-2">
                <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
                <span className="text-xs">Loading message...</span>
              </div>
            ) : (
              /* FULL MESSAGE VIEW */
              <div className="flex flex-col h-full overflow-hidden">
                {/* Action Bar Header */}
                <div className="flex items-center justify-between px-6 py-3 border-b border-slate-200 bg-white">
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => {
                        setComposerMode("reply");
                        setIsComposerOpen(true);
                      }}
                      className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
                      title="Reply"
                    >
                      <Reply className="w-3.5 h-3.5 text-slate-600" />
                      <span>Reply</span>
                    </button>

                    <button
                      onClick={() => {
                        setComposerMode("reply-all");
                        setIsComposerOpen(true);
                      }}
                      className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
                      title="Reply All"
                    >
                      <ReplyAll className="w-3.5 h-3.5 text-slate-600" />
                      <span>Reply All</span>
                    </button>

                    <button
                      onClick={() => {
                        setComposerMode("forward");
                        setIsComposerOpen(true);
                      }}
                      className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
                      title="Forward"
                    >
                      <Forward className="w-3.5 h-3.5 text-slate-600" />
                      <span>Forward</span>
                    </button>

                    <div className="w-[1px] h-4 bg-slate-200 mx-1" />

                    <button
                      onClick={() => handleToggleRead(fullMessage.id, fullMessage.isRead)}
                      className="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors"
                      title={fullMessage.isRead ? "Mark as unread" : "Mark as read"}
                    >
                      {fullMessage.isRead ? <Mail className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>

                    <button
                      onClick={() => handleToggleStar(fullMessage.id, fullMessage.isStarred)}
                      className="p-1.5 text-slate-500 hover:text-amber-500 hover:bg-slate-100 rounded-lg transition-colors"
                      title={fullMessage.isStarred ? "Unstar" : "Star message"}
                    >
                      <Star
                        className={`w-4 h-4 ${
                          fullMessage.isStarred ? "text-amber-500 fill-amber-500" : ""
                        }`}
                      />
                    </button>

                    <button
                      onClick={() => handleDeleteMessage(fullMessage.id)}
                      className="p-1.5 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                      title="Delete / Move to Trash"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="text-xs text-slate-400">
                    {format(parseISO(fullMessage.date), "PPP · p")}
                  </div>
                </div>

                {/* Email Content Container */}
                <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
                  {/* Subject */}
                  <h2 className="text-lg font-bold text-slate-900 tracking-tight">
                    {fullMessage.subject || "(No Subject)"}
                  </h2>

                  {/* Sender & Recipient Metadata */}
                  <div className="flex items-start justify-between pb-3 border-b border-slate-100 text-xs">
                    <div className="flex items-start gap-3">
                      <div className="w-9 h-9 rounded-full bg-blue-100 text-blue-700 font-bold flex items-center justify-center shrink-0 text-sm">
                        {(fullMessage.fromName || fullMessage.fromAddress).slice(0, 1).toUpperCase()}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-slate-900">
                            {fullMessage.fromName || fullMessage.fromAddress}
                          </span>
                          <span className="text-slate-400 font-mono text-[11px]">
                            &lt;{fullMessage.fromAddress}&gt;
                          </span>
                        </div>
                        <div className="text-slate-500 text-[11px] mt-0.5">
                          To: {fullMessage.toAddresses}
                        </div>
                      </div>
                    </div>

                    <div className="text-right">
                      <span className="text-[11px] font-medium text-slate-500 px-2 py-0.5 bg-slate-100 rounded">
                        {fullMessage.account.label}
                      </span>
                    </div>
                  </div>

                  {/* Privacy Banner for Tracking Protection */}
                  <div className="p-3 bg-amber-50/80 border border-amber-200 rounded-lg flex items-center justify-between text-xs text-amber-900">
                    <div className="flex items-center gap-2">
                      <Shield className="w-4 h-4 text-amber-600 shrink-0" />
                      <span>
                        {loadRemoteImages
                          ? "Remote images proxied through safe privacy gateway."
                          : "Remote images are blocked to prevent email senders from tracking you."}
                      </span>
                    </div>
                    {!loadRemoteImages ? (
                      <button
                        onClick={() => setLoadRemoteImages(true)}
                        className="px-2.5 py-1 text-xs font-semibold text-amber-800 bg-amber-100 hover:bg-amber-200 rounded transition-colors"
                      >
                        Load Images
                      </button>
                    ) : (
                      <button
                        onClick={() => setLoadRemoteImages(false)}
                        className="px-2.5 py-1 text-xs font-semibold text-amber-800 bg-amber-100 hover:bg-amber-200 rounded transition-colors"
                      >
                        Hide Images
                      </button>
                    )}
                  </div>

                  {/* Attachments Strip */}
                  {fullMessage.attachments && fullMessage.attachments.length > 0 && (
                    <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                      <div className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                        <Paperclip className="w-3.5 h-3.5" />
                        <span>Attachments ({fullMessage.attachments.length})</span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {fullMessage.attachments.map((att) => (
                          <div
                            key={att.id}
                            className="flex items-center gap-2 bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-slate-800 shadow-2xs"
                          >
                            <span className="font-medium max-w-[200px] truncate">{att.filename}</span>
                            <span className="text-slate-400">({Math.round(att.size / 1024)} KB)</span>
                            <a
                              href={`/api/attachments/${att.id}`}
                              download={att.filename}
                              className="text-blue-600 hover:text-blue-800 p-1 rounded hover:bg-blue-50 transition-colors"
                              title="Download attachment"
                            >
                              <Download className="w-3.5 h-3.5" />
                            </a>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Sandboxed HTML Email Renderer */}
                  <MailRenderer
                    rawHtml={fullMessage.bodyHtml}
                    bodyText={fullMessage.bodyText}
                    loadRemoteImages={loadRemoteImages}
                  />

                  {/* Quick Reply Form at Bottom */}
                  <div className="pt-4 mt-6 border-t border-slate-200">
                    <form onSubmit={handleSendQuickReply} className="space-y-2">
                      <div className="flex items-center justify-between text-xs text-slate-500 font-semibold">
                        <span>Quick Reply to {fullMessage.fromName || fullMessage.fromAddress}</span>
                        <button
                          type="button"
                          onClick={() => {
                            setComposerMode("reply");
                            setIsComposerOpen(true);
                          }}
                          className="text-blue-600 hover:underline"
                        >
                          Open in full composer
                        </button>
                      </div>
                      <textarea
                        rows={3}
                        value={quickReplyText}
                        onChange={(e) => setQuickReplyText(e.target.value)}
                        placeholder="Type a quick reply..."
                        className="w-full p-3 border border-slate-300 rounded-lg text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                      />
                      <div className="flex justify-end">
                        <button
                          type="submit"
                          disabled={isSendingQuickReply || !quickReplyText.trim()}
                          className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors shadow-sm disabled:opacity-50"
                        >
                          {isSendingQuickReply ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Send className="w-3.5 h-3.5" />
                          )}
                          <span>Send Reply</span>
                        </button>
                      </div>
                    </form>
                  </div>
                </div>
              </div>
            )}
          </div>
        </main>
      )}

      {/* Account Settings Modal */}
      {isAccountModalOpen && (
        <AccountModal
          accounts={accounts}
          initialTab={accountModalTab}
          onClose={() => setIsAccountModalOpen(false)}
          onRefresh={() => {
            loadAccountsAndFolders();
            loadMessages();
          }}
        />
      )}
    </div>
    </ErrorBoundary>
  );
}
