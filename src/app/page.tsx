"use client";

import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { format, isToday, isYesterday, parseISO } from "date-fns";
import {
  Mail,
  Inbox,
  Star,
  Send,
  Archive,
  Trash2,
  Calendar,
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
  ShieldCheck,
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
  CheckSquare,
  Square,
  MinusSquare,
  MailOpen,
  SlidersHorizontal,
  Tag,
  FileText,
} from "lucide-react";

import { MailRenderer } from "@/components/mail/MailRenderer";
import { MailComposer } from "@/components/mail/MailComposer";
import { ResizableComposerModal } from "@/components/mail/ResizableComposerModal";
import { CalendarView } from "@/components/calendar/CalendarView";
import { CalendarInviteBanner } from "@/components/mail/CalendarInviteBanner";
import { AdvancedSearchModal } from "@/components/mail/AdvancedSearchModal";
import { AccountModal } from "@/components/accounts/AccountModal";
import { AuthScreen } from "@/components/auth/AuthScreen";
import { useLiveStream, playChime } from "@/hooks/useLiveStream";
import { ErrorBoundary } from "@/components/common/ErrorBoundary";
import {
  buildQuotedHtml,
  buildQuotedPlaintext,
  escapeHtml,
} from "@/lib/email-quote";

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
  hasCalendarInvite?: boolean;
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
  calendarInvite?: any;
  userRsvpStatus?: "accepted" | "tentative" | "declined" | null;
  calendarEventId?: string | null;
  attachments?: Array<{
    id: string;
    filename: string;
    contentType: string;
    size: number;
    contentId?: string | null;
    dataBase64?: string | null;
  }>;
}

function splitAccountFolders(folders: FolderItem[]) {
  // Filter out IMAP container namespaces that don't hold mail directly
  const valid = folders.filter(
    (f) =>
      f.name !== "[Gmail]" &&
      f.path !== "[Gmail]" &&
      f.name !== "[Google Mail]" &&
      f.path !== "[Google Mail]"
  );

  const systemOrder = [
    {
      key: "inbox",
      matcher: (f: FolderItem) => f.specialUse === "\\Inbox" || f.path === "INBOX" || f.name.toUpperCase() === "INBOX",
      cleanName: "Inbox",
      Icon: Inbox,
    },
    {
      key: "starred",
      matcher: (f: FolderItem) =>
        f.specialUse === "\\Flagged" ||
        f.path.toLowerCase().includes("starred") ||
        f.name.toLowerCase().includes("starred"),
      cleanName: "Starred",
      Icon: Star,
    },
    {
      key: "sent",
      matcher: (f: FolderItem) =>
        f.specialUse === "\\Sent" ||
        f.path.toLowerCase().includes("sent") ||
        f.name.toLowerCase().includes("sent"),
      cleanName: "Sent",
      Icon: Send,
    },
    {
      key: "drafts",
      matcher: (f: FolderItem) =>
        f.specialUse === "\\Drafts" ||
        f.path.toLowerCase().includes("draft") ||
        f.name.toLowerCase().includes("draft"),
      cleanName: "Drafts",
      Icon: FileText,
    },
    {
      key: "archive",
      matcher: (f: FolderItem) =>
        f.specialUse === "\\Archive" ||
        f.specialUse === "\\All" ||
        f.path.toLowerCase().includes("all mail") ||
        f.name.toLowerCase().includes("all mail") ||
        f.path.toLowerCase().includes("archive") ||
        f.name.toLowerCase().includes("archive"),
      cleanName: "All Mail",
      Icon: Archive,
    },
    {
      key: "spam",
      matcher: (f: FolderItem) =>
        f.specialUse === "\\Junk" ||
        f.path.toLowerCase().includes("spam") ||
        f.name.toLowerCase().includes("spam") ||
        f.path.toLowerCase().includes("junk") ||
        f.name.toLowerCase().includes("junk"),
      cleanName: "Spam",
      Icon: ShieldAlert,
    },
    {
      key: "trash",
      matcher: (f: FolderItem) =>
        f.specialUse === "\\Trash" ||
        f.path.toLowerCase().includes("trash") ||
        f.name.toLowerCase().includes("trash") ||
        f.path.toLowerCase().includes("bin") ||
        f.name.toLowerCase().includes("bin"),
      cleanName: "Trash",
      Icon: Trash2,
    },
  ];

  const systemFolders: Array<{ folder: FolderItem; displayName: string; Icon: any }> = [];
  const systemIds = new Set<string>();

  for (const sys of systemOrder) {
    const match = valid.find((f) => sys.matcher(f));
    if (match && !systemIds.has(match.id)) {
      systemFolders.push({
        folder: match,
        displayName: sys.cleanName,
        Icon: sys.Icon,
      });
      systemIds.add(match.id);
    }
  }

  // Any remaining folders are custom labels / folders created by the user
  const userLabels = valid.filter((f) => !systemIds.has(f.id));

  return { systemFolders, userLabels };
}

export default function OmniMailApp() {
  // Navigation & View Mode
  const [currentTab, setCurrentTab] = useState<"mail" | "calendar">("mail");
  const [calendarInitialDate, setCalendarInitialDate] = useState<Date | null>(null);
  const [currentView, setCurrentView] = useState<"inbox" | "starred" | "sent" | "archive" | "trash" | "folder">("inbox");
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null); // null = All Inboxes / Unified
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);

  // Filter & Search
  const [filterMode, setFilterMode] = useState<"all" | "unread" | "starred" | "attachments">("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [debouncedSearch, setDebouncedSearch] = useState<string>("");
  const [isAdvancedSearchOpen, setIsAdvancedSearchOpen] = useState<boolean>(false);

  // Data
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [unifiedCounts, setUnifiedCounts] = useState<{ inboxUnread: number; starred: number }>({
    inboxUnread: 0,
    starred: 0,
  });
  const [messages, setMessages] = useState<MessageListItem[]>([]);
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);
  const selectedMessageIdRef = useRef<string | null>(null);
  selectedMessageIdRef.current = selectedMessageId;

  const newMessageDebounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [fullMessage, setFullMessage] = useState<FullMessage | null>(null);
  const [threadMessages, setThreadMessages] = useState<FullMessage[]>([]);
  const [expandedMessageIds, setExpandedMessageIds] = useState<Set<string>>(new Set());

  // Optimistic preview message so switching emails never flashes or unmounts the reading pane
  const activeSummaryMessage = useMemo(() => {
    return messages.find((m) => m.id === selectedMessageId) || null;
  }, [messages, selectedMessageId]);

  const activeDisplayMessage: FullMessage | null = useMemo(() => {
    if (!selectedMessageId) return null;
    if (fullMessage && fullMessage.id === selectedMessageId) {
      return fullMessage;
    }
    if (activeSummaryMessage) {
      return {
        ...activeSummaryMessage,
        bodyHtml: null,
        bodyText: activeSummaryMessage.snippet || "",
        attachments: [],
      } as FullMessage;
    }
    return fullMessage;
  }, [selectedMessageId, fullMessage, activeSummaryMessage]);

  const displayThreadMessages: FullMessage[] = useMemo(() => {
    if (fullMessage && fullMessage.id === selectedMessageId && threadMessages.length > 0) {
      return threadMessages;
    }
    if (activeDisplayMessage) {
      return [activeDisplayMessage];
    }
    return [];
  }, [fullMessage, selectedMessageId, threadMessages, activeDisplayMessage]);

  // States
  const [isLoadingMessages, setIsLoadingMessages] = useState<boolean>(true);
  const [isLoadingDetail, setIsLoadingDetail] = useState<boolean>(false);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [loadRemoteImages, setLoadRemoteImages] = useState<boolean>(false);

  // Multi-selection & Batch Action State
  const [selectedMessageIds, setSelectedMessageIds] = useState<Set<string>>(new Set());
  const [lastSelectedMessageIndex, setLastSelectedMessageIndex] = useState<number | null>(null);
  const [isBatchProcessing, setIsBatchProcessing] = useState<boolean>(false);
  const [isSelectionDropdownOpen, setIsSelectionDropdownOpen] = useState<boolean>(false);

  // Composer State
  const [isComposerOpen, setIsComposerOpen] = useState<boolean>(false);
  const [composerMode, setComposerMode] = useState<"new" | "reply" | "reply-all" | "forward">("new");
  const [composerInitialBody, setComposerInitialBody] = useState<string>("");

  // Account Modal
  const [isAccountModalOpen, setIsAccountModalOpen] = useState<boolean>(false);
  const [accountModalTab, setAccountModalTab] = useState<"list" | "add" | "notifications" | "sync" | "images">("list");

  // Trusted Senders (Remote Images automatic loading)
  const [trustedSenders, setTrustedSenders] = useState<Set<string>>(new Set());

  const loadTrustedSenders = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/trusted-senders");
      if (res.ok) {
        const data = await res.json();
        const sendersList: Array<{ email: string }> = data.senders || [];
        setTrustedSenders(new Set(sendersList.map((s) => s.email.toLowerCase())));
      }
    } catch (err) {
      console.error("Error loading trusted senders:", err);
    }
  }, []);

  useEffect(() => {
    loadTrustedSenders();
  }, [loadTrustedSenders]);

  const handleAlwaysLoadFromSender = async (email: string) => {
    try {
      const res = await fetch("/api/settings/trusted-senders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (res.ok) {
        setTrustedSenders((prev) => new Set(prev).add(email.toLowerCase()));
        setLoadRemoteImages(true);
      }
    } catch (err) {
      console.error("Error adding trusted sender:", err);
    }
  };

  const handleRemoveTrustedSender = async (email: string) => {
    try {
      const res = await fetch(`/api/settings/trusted-senders?email=${encodeURIComponent(email)}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setTrustedSenders((prev) => {
          const next = new Set(prev);
          next.delete(email.toLowerCase());
          return next;
        });
        setLoadRemoteImages(false);
      }
    } catch (err) {
      console.error("Error removing trusted sender:", err);
    }
  };

  const cleanSenderEmail = useMemo(() => {
    if (!activeDisplayMessage?.fromAddress) return "";
    let email = activeDisplayMessage.fromAddress.trim().toLowerCase();
    const match = email.match(/<([^>]+)>/);
    if (match && match[1]) email = match[1].trim().toLowerCase();
    return email;
  }, [activeDisplayMessage?.fromAddress]);

  const isSenderTrusted = useMemo(() => {
    if (!cleanSenderEmail || trustedSenders.size === 0) return false;
    if (trustedSenders.has(cleanSenderEmail)) return true;
    const atIndex = cleanSenderEmail.indexOf("@");
    if (atIndex !== -1) {
      const domain = cleanSenderEmail.slice(atIndex); // e.g. "@github.com"
      if (trustedSenders.has(domain)) return true;
    }
    return false;
  }, [cleanSenderEmail, trustedSenders]);

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

  const handleToggleSearchToken = (token: string) => {
    setSearchQuery((prev) => {
      const parts = prev.trim().split(/\s+/).filter(Boolean);
      const exists = parts.some((p) => p.toLowerCase() === token.toLowerCase());
      if (exists) {
        return parts.filter((p) => p.toLowerCase() !== token.toLowerCase()).join(" ");
      } else {
        return parts.length > 0 ? `${parts.join(" ")} ${token}` : token;
      }
    });
  };

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
  const loadMessages = useCallback(async (silent: boolean = false) => {
    if (!silent) setIsLoadingMessages(true);
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
        if (data.messages && data.messages.length > 0 && !selectedMessageIdRef.current) {
          setSelectedMessageId(data.messages[0].id);
        }
      }
    } catch (err) {
      console.error("Error loading messages:", err);
    } finally {
      if (!silent) setIsLoadingMessages(false);
    }
  }, [selectedAccountId, selectedFolderId, currentView, filterMode, debouncedSearch]);

  useEffect(() => {
    loadMessages();
  }, [loadMessages]);

  // Load Full Message Detail
  useEffect(() => {
    if (!selectedMessageId) {
      setFullMessage(null);
      setThreadMessages([]);
      setExpandedMessageIds(new Set());
      return;
    }

    let isSubscribed = true;
    setIsLoadingDetail(true);

    const activeMsg = messages.find((m) => m.id === selectedMessageId);
    let senderEmail = activeMsg?.fromAddress?.trim().toLowerCase() || "";
    const mMatch = senderEmail.match(/<([^>]+)>/);
    if (mMatch && mMatch[1]) senderEmail = mMatch[1].trim().toLowerCase();
    const isAutoTrusted = Boolean(
      senderEmail && (
        trustedSenders.has(senderEmail) ||
        (senderEmail.includes("@") && trustedSenders.has(senderEmail.slice(senderEmail.indexOf("@"))))
      )
    );
    setLoadRemoteImages(isAutoTrusted);

    fetch(`/api/messages/${selectedMessageId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!isSubscribed) return;
        if (data?.message) {
          setFullMessage(data.message);
          const threadList: FullMessage[] =
            data.thread && Array.isArray(data.thread) && data.thread.length > 0
              ? data.thread
              : [data.message];
          setThreadMessages(threadList);
          // By default expand the latest message in the thread
          setExpandedMessageIds(new Set([threadList[threadList.length - 1].id]));

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
  }, [selectedMessageId, trustedSenders]);

  useEffect(() => {
    if (isSenderTrusted) {
      setLoadRemoteImages(true);
    }
  }, [isSenderTrusted]);

  // Real-Time Live Stream SSE Integration
  const { isConnected, notificationPermission, requestNotificationPermission } = useLiveStream({
    onNewMessage: (data) => {
      // Coalesce rapid backfill or batch events to prevent UI thrashing
      if (newMessageDebounceTimerRef.current) {
        clearTimeout(newMessageDebounceTimerRef.current);
      }
      newMessageDebounceTimerRef.current = setTimeout(() => {
        loadAccountsAndFolders();
        loadMessages(true);
      }, 300);
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

  useEffect(() => {
    return () => {
      if (newMessageDebounceTimerRef.current) {
        clearTimeout(newMessageDebounceTimerRef.current);
      }
    };
  }, []);

  // Upcoming Calendar Reminders (10-30 minutes before event)
  useEffect(() => {
    const remindedEvents = new Set<string>();

    const checkUpcomingReminders = async () => {
      try {
        const now = Date.now();
        const start = new Date(now).toISOString();
        const end = new Date(now + 45 * 60 * 1000).toISOString();
        const res = await fetch(`/api/calendar?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`);
        if (!res.ok) return;
        const data = await res.json();
        const upcomingList: any[] = data.events || [];

        for (const ev of upcomingList) {
          const startTime = new Date(ev.startDate).getTime();
          const diffMinutes = Math.round((startTime - now) / 60000);

          if (diffMinutes > 0 && diffMinutes <= 30) {
            const bucket = diffMinutes <= 10 ? "10m" : diffMinutes <= 20 ? "20m" : "30m";
            const reminderKey = `${ev.id}-${bucket}`;

            if (!remindedEvents.has(reminderKey)) {
              remindedEvents.add(reminderKey);

              playChime();

              if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
                const notif = new Notification(`Upcoming Meeting in ${diffMinutes}m: ${ev.summary}`, {
                  body: `${ev.location ? `📍 ${ev.location}\n` : ""}${ev.description ? ev.description.slice(0, 100) : "Event starting soon"}`,
                  icon: "/icon.svg",
                  tag: `calendar-${ev.id}-${bucket}`,
                });
                notif.onclick = () => {
                  window.focus();
                  setCurrentTab("calendar");
                  notif.close();
                };
              }
            }
          }
        }
      } catch (err) {
        // Silently catch reminder check error
      }
    };

    checkUpcomingReminders();
    const timer = setInterval(checkUpcomingReminders, 60000);
    return () => clearInterval(timer);
  }, []);

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

  // Archive Single Message
  const handleArchiveMessage = async (msgId: string) => {
    try {
      await fetch("/api/messages/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageIds: [msgId], action: "archive" }),
      });
      setMessages((prev) => prev.filter((m) => m.id !== msgId));
      if (selectedMessageId === msgId) {
        setSelectedMessageId(null);
        setFullMessage(null);
      }
      loadAccountsAndFolders();
    } catch (err) {
      console.error("Error archiving message:", err);
    }
  };

  // Reset multi-selection when view or search query changes
  useEffect(() => {
    setSelectedMessageIds(new Set());
    setLastSelectedMessageIndex(null);
    setIsSelectionDropdownOpen(false);
  }, [selectedAccountId, selectedFolderId, currentView, filterMode, debouncedSearch]);

  // Multi-selection Handlers
  const handleToggleSelectMessage = (
    id: string,
    index: number,
    shiftKey: boolean,
    e?: React.MouseEvent
  ) => {
    e?.stopPropagation();

    if (shiftKey && lastSelectedMessageIndex !== null) {
      const startIndex = Math.min(lastSelectedMessageIndex, index);
      const endIndex = Math.max(lastSelectedMessageIndex, index);
      const rangeIds = messages.slice(startIndex, endIndex + 1).map((m) => m.id);

      setSelectedMessageIds((prev) => {
        const next = new Set(prev);
        rangeIds.forEach((msgId) => next.add(msgId));
        return next;
      });
    } else {
      setSelectedMessageIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
        return next;
      });
      setLastSelectedMessageIndex(index);
    }
  };

  const handleSelectAll = () => {
    setSelectedMessageIds(new Set(messages.map((m) => m.id)));
    setIsSelectionDropdownOpen(false);
  };

  const handleDeselectAll = () => {
    setSelectedMessageIds(new Set());
    setLastSelectedMessageIndex(null);
    setIsSelectionDropdownOpen(false);
  };

  // Keyboard shortcuts: Cmd/Ctrl + A to select all, Escape to deselect all
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeTag = document.activeElement?.tagName.toLowerCase();
      const isEditable = document.activeElement?.getAttribute("contenteditable") === "true";
      if (activeTag === "input" || activeTag === "textarea" || isEditable) {
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a") {
        if (messages.length > 0) {
          e.preventDefault();
          setSelectedMessageIds(new Set(messages.map((m) => m.id)));
        }
      } else if (e.key === "Escape") {
        if (selectedMessageIds.size > 0) {
          setSelectedMessageIds(new Set());
          setLastSelectedMessageIndex(null);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [messages, selectedMessageIds]);

  const handleSelectByFilter = (type: "all" | "none" | "read" | "unread" | "starred") => {
    setIsSelectionDropdownOpen(false);
    if (type === "none") {
      setSelectedMessageIds(new Set());
      setLastSelectedMessageIndex(null);
      return;
    }
    if (type === "all") {
      setSelectedMessageIds(new Set(messages.map((m) => m.id)));
      return;
    }
    if (type === "read") {
      setSelectedMessageIds(new Set(messages.filter((m) => m.isRead).map((m) => m.id)));
      return;
    }
    if (type === "unread") {
      setSelectedMessageIds(new Set(messages.filter((m) => !m.isRead).map((m) => m.id)));
      return;
    }
    if (type === "starred") {
      setSelectedMessageIds(new Set(messages.filter((m) => m.isStarred).map((m) => m.id)));
      return;
    }
  };

  const handleBatchAction = async (
    action: "mark-read" | "mark-unread" | "star" | "unstar" | "trash" | "archive" | "delete"
  ) => {
    if (selectedMessageIds.size === 0 || isBatchProcessing) return;

    if (action === "delete") {
      const ok = window.confirm(
        `Are you sure you want to permanently delete ${selectedMessageIds.size} message(s)? This action cannot be undone.`
      );
      if (!ok) return;
    }

    const idsToProcess = Array.from(selectedMessageIds);
    setIsBatchProcessing(true);

    // Optimistic UI updates
    if (action === "mark-read") {
      setMessages((prev) =>
        prev.map((m) => (selectedMessageIds.has(m.id) ? { ...m, isRead: true } : m))
      );
    } else if (action === "mark-unread") {
      setMessages((prev) =>
        prev.map((m) => (selectedMessageIds.has(m.id) ? { ...m, isRead: false } : m))
      );
    } else if (action === "star") {
      setMessages((prev) =>
        prev.map((m) => (selectedMessageIds.has(m.id) ? { ...m, isStarred: true } : m))
      );
    } else if (action === "unstar") {
      setMessages((prev) =>
        prev.map((m) => (selectedMessageIds.has(m.id) ? { ...m, isStarred: false } : m))
      );
    } else if (action === "trash" || action === "archive" || action === "delete") {
      setMessages((prev) => prev.filter((m) => !selectedMessageIds.has(m.id)));
      if (selectedMessageId && selectedMessageIds.has(selectedMessageId)) {
        setSelectedMessageId(null);
        setFullMessage(null);
      }
    }

    try {
      const res = await fetch("/api/messages/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messageIds: idsToProcess,
          action,
        }),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || "Batch action failed");
      }

      setSelectedMessageIds(new Set());
      setLastSelectedMessageIndex(null);
      await Promise.all([loadMessages(true), loadAccountsAndFolders()]);
    } catch (err: any) {
      console.error("Batch action failed:", err);
      alert("Batch action failed: " + err.message);
      loadMessages(true);
    } finally {
      setIsBatchProcessing(false);
    }
  };

  // Quick Reply handler
  const handleSendQuickReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickReplyText.trim() || !activeDisplayMessage) return;

    // Use the latest message in the thread as the quote target
    const targetMsg =
      displayThreadMessages.length > 0
        ? displayThreadMessages[displayThreadMessages.length - 1]
        : activeDisplayMessage;

    setIsSendingQuickReply(true);
    try {
      const quotedHtml = buildQuotedHtml(targetMsg);
      const quotedText = buildQuotedPlaintext(targetMsg);
      const bodyHtml = `<div>${escapeHtml(quickReplyText).replace(/\n/g, "<br>")}</div><br>${quotedHtml}`;
      const bodyText = `${quickReplyText}${quotedText}`;

      const res = await fetch("/api/messages/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId: targetMsg.accountId,
          to: [targetMsg.fromAddress],
          subject: targetMsg.subject?.toLowerCase().startsWith("re:")
            ? targetMsg.subject
            : `Re: ${targetMsg.subject || ""}`,
          bodyHtml,
          bodyText,
          inReplyTo: targetMsg.messageId || undefined,
          references: targetMsg.messageId || targetMsg.threadId || undefined,
          threadId: targetMsg.threadId || targetMsg.messageId || undefined,
        }),
      });

      if (res.ok) {
        setQuickReplyText("");
        if (selectedMessageId) {
          fetch(`/api/messages/${selectedMessageId}`)
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => {
              if (d?.thread) {
                setThreadMessages(d.thread);
                setExpandedMessageIds((prev) => {
                  const next = new Set(prev);
                  next.add(d.thread[d.thread.length - 1].id);
                  return next;
                });
              }
            });
        }
        loadMessages(true);
        loadAccountsAndFolders();
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
              setComposerInitialBody("");
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

                  {isExpanded && (() => {
                    const { systemFolders, userLabels } = splitAccountFolders(accFolders);
                    return (
                      <div className="pl-4 space-y-1.5 border-l border-slate-800 ml-3 mt-1">
                        {/* 1. Actual System Inboxes / Mailboxes */}
                        <div className="space-y-0.5">
                          {systemFolders.map(({ folder: f, displayName, Icon }) => {
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
                                <div className="flex items-center gap-1.5 truncate">
                                  <Icon className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                                  <span className="truncate">{displayName}</span>
                                </div>
                                {f.unreadCount > 0 && (
                                  <span className="px-1.5 py-0.2 rounded-full text-[9px] font-bold bg-blue-600 text-white">
                                    {f.unreadCount}
                                  </span>
                                )}
                              </button>
                            );
                          })}
                        </div>

                        {/* 2. User-Created Labels / Custom Folders */}
                        {userLabels.length > 0 && (
                          <div className="pt-2 border-t border-slate-800/70 space-y-0.5">
                            <div className="px-2 py-0.5 flex items-center justify-between text-[10px] font-bold text-slate-500 uppercase tracking-wider select-none">
                              <span className="flex items-center gap-1.5 text-slate-400">
                                <Tag className="w-3 h-3 text-slate-400" />
                                <span>Labels</span>
                              </span>
                              <span className="text-[9px] text-slate-500 px-1 py-0.2 rounded bg-slate-800 font-mono">
                                {userLabels.length}
                              </span>
                            </div>

                            {userLabels.map((f) => {
                              const isSelected = selectedFolderId === f.id;
                              const cleanName = f.name.replace(/^\[Gmail\]\/?/i, "").trim();
                              const isNested = cleanName.includes("/") || f.path.includes("/");
                              const parts = cleanName.split("/").map((p) => p.trim());
                              const leafName = parts[parts.length - 1];

                              return (
                                <button
                                  key={f.id}
                                  onClick={() => {
                                    setCurrentTab("mail");
                                    setSelectedAccountId(acc.id);
                                    setSelectedFolderId(f.id);
                                  }}
                                  className={`w-full flex items-center justify-between px-2 py-1 rounded text-[11px] transition-colors ${
                                    isNested ? "pl-3.5" : ""
                                  } ${
                                    isSelected
                                      ? "bg-slate-800 text-white font-semibold"
                                      : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/30"
                                  }`}
                                  title={cleanName}
                                >
                                  <div className="flex items-center gap-1.5 truncate">
                                    <Tag className="w-3 h-3 text-slate-500 shrink-0" />
                                    <span className="truncate">{cleanName}</span>
                                  </div>
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
                  })()}
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
          <CalendarView onRefreshTrigger={loadAccountsAndFolders} initialDate={calendarInitialDate} />
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
            <div className="p-3 border-b border-slate-200 space-y-2">
              <div className="relative flex items-center">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5 pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search in mail (e.g. from:amy larger:5M)..."
                  className="w-full pl-9 pr-16 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all"
                />
                <div className="absolute right-1.5 flex items-center gap-0.5">
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery("")}
                      className="p-1 text-slate-400 hover:text-slate-600 rounded transition-colors"
                      title="Clear search"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setIsAdvancedSearchOpen(true)}
                    className={`p-1 rounded transition-colors ${
                      isAdvancedSearchOpen || (searchQuery && (searchQuery.includes(":") || searchQuery.includes("-")))
                        ? "text-blue-600 bg-blue-50 hover:bg-blue-100"
                        : "text-slate-400 hover:text-slate-600 hover:bg-slate-100"
                    }`}
                    title="Show advanced search options"
                  >
                    <SlidersHorizontal className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Quick filter chips */}
              <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 no-scrollbar text-[11px]">
                <button
                  type="button"
                  onClick={() => handleToggleSearchToken("has:attachment")}
                  className={`px-2 py-0.5 rounded-full border transition-all shrink-0 flex items-center gap-1 font-medium ${
                    searchQuery.toLowerCase().includes("has:attachment")
                      ? "bg-blue-50 border-blue-300 text-blue-700 font-semibold"
                      : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  <Paperclip className="w-3 h-3" />
                  <span>Has attachment</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleToggleSearchToken("has:invite")}
                  className={`px-2 py-0.5 rounded-full border transition-all shrink-0 flex items-center gap-1 font-medium ${
                    searchQuery.toLowerCase().includes("has:invite")
                      ? "bg-blue-50 border-blue-300 text-blue-700 font-semibold"
                      : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  <Calendar className="w-3 h-3 text-blue-600" />
                  <span>Invite</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleToggleSearchToken("is:unread")}
                  className={`px-2 py-0.5 rounded-full border transition-all shrink-0 flex items-center gap-1 font-medium ${
                    searchQuery.toLowerCase().includes("is:unread")
                      ? "bg-blue-50 border-blue-300 text-blue-700 font-semibold"
                      : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  <span>Unread</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleToggleSearchToken("is:starred")}
                  className={`px-2 py-0.5 rounded-full border transition-all shrink-0 flex items-center gap-1 font-medium ${
                    searchQuery.toLowerCase().includes("is:starred")
                      ? "bg-amber-50 border-amber-300 text-amber-800 font-semibold"
                      : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  <Star className="w-3 h-3 text-amber-500 fill-amber-500" />
                  <span>Starred</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleToggleSearchToken("larger:5M")}
                  className={`px-2 py-0.5 rounded-full border transition-all shrink-0 font-medium ${
                    searchQuery.toLowerCase().includes("larger:5m")
                      ? "bg-blue-50 border-blue-300 text-blue-700 font-semibold"
                      : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  &gt; 5MB
                </button>
                <button
                  type="button"
                  onClick={() => handleToggleSearchToken("newer_than:7d")}
                  className={`px-2 py-0.5 rounded-full border transition-all shrink-0 font-medium ${
                    searchQuery.toLowerCase().includes("newer_than:7d")
                      ? "bg-blue-50 border-blue-300 text-blue-700 font-semibold"
                      : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  Past 7d
                </button>
              </div>

              {/* Filter tabs & Batch Action Toolbar */}
              {selectedMessageIds.size > 0 ? (
                <div className="bg-slate-900 text-white px-2.5 py-1.5 rounded-lg flex items-center justify-between shadow-xs">
                  <div className="flex items-center gap-2">
                    {/* Checkbox dropdown button */}
                    <div className="relative">
                      <div className="flex items-center bg-slate-800 rounded p-0.5 text-blue-400">
                        <button
                          type="button"
                          onClick={handleDeselectAll}
                          className="p-1 hover:text-white transition-colors"
                          title="Deselect all"
                        >
                          {selectedMessageIds.size === messages.length && messages.length > 0 ? (
                            <CheckSquare className="w-3.5 h-3.5" />
                          ) : (
                            <MinusSquare className="w-3.5 h-3.5" />
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => setIsSelectionDropdownOpen((p) => !p)}
                          className="p-1 hover:text-white transition-colors border-l border-slate-700"
                          title="Selection menu"
                        >
                          <ChevronDown className="w-3 h-3 text-slate-400" />
                        </button>
                      </div>

                      {isSelectionDropdownOpen && (
                        <>
                          <div
                            className="fixed inset-0 z-20"
                            onClick={() => setIsSelectionDropdownOpen(false)}
                          />
                          <div className="absolute left-0 mt-1 w-32 bg-white text-slate-800 border border-slate-200 rounded-lg shadow-xl z-30 py-1 text-[11px] font-medium animate-in fade-in-50">
                            <button
                              type="button"
                              onClick={() => handleSelectByFilter("all")}
                              className="w-full text-left px-3 py-1.5 hover:bg-slate-100 flex items-center justify-between"
                            >
                              <span>All</span>
                              <span className="text-[10px] text-slate-400">{messages.length}</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleSelectByFilter("none")}
                              className="w-full text-left px-3 py-1.5 hover:bg-slate-100"
                            >
                              None
                            </button>
                            <button
                              type="button"
                              onClick={() => handleSelectByFilter("read")}
                              className="w-full text-left px-3 py-1.5 hover:bg-slate-100 flex items-center justify-between"
                            >
                              <span>Read</span>
                              <span className="text-[10px] text-slate-400">
                                {messages.filter((m) => m.isRead).length}
                              </span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleSelectByFilter("unread")}
                              className="w-full text-left px-3 py-1.5 hover:bg-slate-100 flex items-center justify-between"
                            >
                              <span>Unread</span>
                              <span className="text-[10px] text-slate-400">
                                {messages.filter((m) => !m.isRead).length}
                              </span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleSelectByFilter("starred")}
                              className="w-full text-left px-3 py-1.5 hover:bg-slate-100 flex items-center justify-between"
                            >
                              <span>Starred</span>
                              <span className="text-[10px] text-slate-400">
                                {messages.filter((m) => m.isStarred).length}
                              </span>
                            </button>
                          </div>
                        </>
                      )}
                    </div>

                    <span className="text-[11px] font-semibold text-slate-200 whitespace-nowrap">
                      {selectedMessageIds.size} selected
                    </span>
                  </div>

                  {/* Batch Action Buttons */}
                  <div className="flex items-center gap-0.5">
                    <button
                      type="button"
                      onClick={() => handleBatchAction("mark-read")}
                      disabled={isBatchProcessing}
                      className="p-1 hover:bg-slate-800 text-slate-300 hover:text-white rounded transition-colors disabled:opacity-50"
                      title="Mark as read"
                    >
                      <MailOpen className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleBatchAction("mark-unread")}
                      disabled={isBatchProcessing}
                      className="p-1 hover:bg-slate-800 text-slate-300 hover:text-white rounded transition-colors disabled:opacity-50"
                      title="Mark as unread"
                    >
                      <Mail className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleBatchAction("star")}
                      disabled={isBatchProcessing}
                      className="p-1 hover:bg-slate-800 text-slate-300 hover:text-amber-400 rounded transition-colors disabled:opacity-50"
                      title="Star selected"
                    >
                      <Star className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleBatchAction("archive")}
                      disabled={isBatchProcessing}
                      className="p-1 hover:bg-slate-800 text-slate-300 hover:text-purple-400 rounded transition-colors disabled:opacity-50"
                      title="Archive selected"
                    >
                      <Archive className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleBatchAction("trash")}
                      disabled={isBatchProcessing}
                      className="p-1 hover:bg-slate-800 text-slate-300 hover:text-rose-400 rounded transition-colors disabled:opacity-50"
                      title="Move to Trash"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleBatchAction("delete")}
                      disabled={isBatchProcessing}
                      className="p-1 hover:bg-rose-950 text-rose-300 hover:text-rose-200 rounded transition-colors disabled:opacity-50"
                      title="Permanently Delete"
                    >
                      <AlertCircle className="w-3.5 h-3.5" />
                    </button>
                    <div className="w-[1px] h-3 bg-slate-700 mx-0.5" />
                    <button
                      type="button"
                      onClick={handleDeselectAll}
                      className="p-1 hover:bg-slate-800 text-slate-400 hover:text-white rounded transition-colors"
                      title="Clear selection"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    {/* Master Select Dropdown */}
                    <div className="relative">
                      <div className="flex items-center bg-slate-100 rounded-lg p-0.5 text-slate-600">
                        <button
                          type="button"
                          onClick={() => {
                            if (messages.length > 0) {
                              handleSelectAll();
                            }
                          }}
                          className="p-1 hover:text-blue-600 transition-colors"
                          title="Select all"
                        >
                          <Square className="w-3.5 h-3.5 text-slate-400 hover:text-slate-600" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setIsSelectionDropdownOpen((p) => !p)}
                          className="p-1 hover:text-blue-600 transition-colors border-l border-slate-200"
                          title="Selection menu"
                        >
                          <ChevronDown className="w-3 h-3 text-slate-400" />
                        </button>
                      </div>

                      {isSelectionDropdownOpen && (
                        <>
                          <div
                            className="fixed inset-0 z-20"
                            onClick={() => setIsSelectionDropdownOpen(false)}
                          />
                          <div className="absolute left-0 mt-1 w-32 bg-white text-slate-800 border border-slate-200 rounded-lg shadow-xl z-30 py-1 text-[11px] font-medium animate-in fade-in-50">
                            <button
                              type="button"
                              onClick={() => handleSelectByFilter("all")}
                              className="w-full text-left px-3 py-1.5 hover:bg-slate-50 flex items-center justify-between"
                            >
                              <span>All</span>
                              <span className="text-[10px] text-slate-400">{messages.length}</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleSelectByFilter("none")}
                              className="w-full text-left px-3 py-1.5 hover:bg-slate-50"
                            >
                              None
                            </button>
                            <button
                              type="button"
                              onClick={() => handleSelectByFilter("read")}
                              className="w-full text-left px-3 py-1.5 hover:bg-slate-50 flex items-center justify-between"
                            >
                              <span>Read</span>
                              <span className="text-[10px] text-slate-400">
                                {messages.filter((m) => m.isRead).length}
                              </span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleSelectByFilter("unread")}
                              className="w-full text-left px-3 py-1.5 hover:bg-slate-50 flex items-center justify-between"
                            >
                              <span>Unread</span>
                              <span className="text-[10px] text-slate-400">
                                {messages.filter((m) => !m.isRead).length}
                              </span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleSelectByFilter("starred")}
                              className="w-full text-left px-3 py-1.5 hover:bg-slate-50 flex items-center justify-between"
                            >
                              <span>Starred</span>
                              <span className="text-[10px] text-slate-400">
                                {messages.filter((m) => m.isStarred).length}
                              </span>
                            </button>
                          </div>
                        </>
                      )}
                    </div>

                    {/* Filter tabs */}
                    <div className="flex items-center gap-0.5 bg-slate-100 p-0.5 rounded-lg text-[11px] font-medium">
                      <button
                        onClick={() => setFilterMode("all")}
                        className={`px-2 py-1 rounded-md transition-colors ${
                          filterMode === "all"
                            ? "bg-white text-slate-900 shadow-xs font-semibold"
                            : "text-slate-500 hover:text-slate-800"
                        }`}
                      >
                        All
                      </button>
                      <button
                        onClick={() => setFilterMode("unread")}
                        className={`px-2 py-1 rounded-md transition-colors ${
                          filterMode === "unread"
                            ? "bg-white text-slate-900 shadow-xs font-semibold"
                            : "text-slate-500 hover:text-slate-800"
                        }`}
                      >
                        Unread
                      </button>
                      <button
                        onClick={() => setFilterMode("starred")}
                        className={`px-2 py-1 rounded-md transition-colors ${
                          filterMode === "starred"
                            ? "bg-white text-slate-900 shadow-xs font-semibold"
                            : "text-slate-500 hover:text-slate-800"
                        }`}
                      >
                        Starred
                      </button>
                      <button
                        onClick={() => setFilterMode("attachments")}
                        className={`px-2 py-1 rounded-md transition-colors ${
                          filterMode === "attachments"
                            ? "bg-white text-slate-900 shadow-xs font-semibold"
                            : "text-slate-500 hover:text-slate-800"
                        }`}
                      >
                        Files
                      </button>
                    </div>
                  </div>

                  <button
                    onClick={handleTriggerSync}
                    className="p-1 text-slate-400 hover:text-slate-600 rounded transition-colors"
                    title="Refresh messages"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? "animate-spin text-blue-600" : ""}`} />
                  </button>
                </div>
              )}
            </div>

            {/* Message Cards List */}
            <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
              {isLoadingMessages && messages.length > 0 && (
                <div className="h-0.5 bg-blue-600 animate-pulse w-full shrink-0" />
              )}
              {isLoadingMessages && messages.length === 0 ? (
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
                messages.map((msg, idx) => {
                  const isSelected = selectedMessageId === msg.id;
                  const isBatchSelected = selectedMessageIds.has(msg.id);
                  return (
                    <div
                      key={msg.id}
                      onClick={(e) => {
                        if (e.metaKey || e.ctrlKey) {
                          e.preventDefault();
                          handleToggleSelectMessage(msg.id, idx, false, e);
                        } else if (e.shiftKey) {
                          e.preventDefault();
                          handleToggleSelectMessage(msg.id, idx, true, e);
                        } else {
                          setSelectedMessageId(msg.id);
                        }
                      }}
                      className={`p-3 cursor-pointer transition-colors relative flex items-start gap-2.5 select-none ${
                        isBatchSelected
                          ? "bg-blue-50/90 ring-1 ring-inset ring-blue-300 border-l-[3px] border-blue-600"
                          : isSelected
                          ? "bg-blue-50/70 border-l-[3px] border-blue-600"
                          : !msg.isRead
                          ? "bg-slate-50/60 hover:bg-slate-100/70"
                          : "bg-white hover:bg-slate-50"
                      }`}
                    >
                      {/* Checkbox button */}
                      <button
                        type="button"
                        onClick={(e) => {
                          if (e.metaKey || e.ctrlKey) {
                            handleToggleSelectMessage(msg.id, idx, false, e);
                          } else if (e.shiftKey) {
                            handleToggleSelectMessage(msg.id, idx, true, e);
                          } else {
                            handleToggleSelectMessage(msg.id, idx, false, e);
                          }
                        }}
                        className="mt-0.5 shrink-0 text-slate-400 hover:text-blue-600 transition-colors focus:outline-none"
                        title="Select (Hold ⌘/Ctrl to select individual, Shift for range)"
                      >
                        {isBatchSelected ? (
                          <CheckSquare className="w-4 h-4 text-blue-600 fill-blue-50" />
                        ) : (
                          <Square className="w-4 h-4 text-slate-300 hover:text-slate-500" />
                        )}
                      </button>

                      {/* Message details */}
                      <div className="flex-1 min-w-0 flex flex-col gap-1">
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

                        {/* Meta badges (Attachments, Account, Calendar Invite) */}
                        <div className="flex items-center gap-2 mt-1">
                          {msg.hasCalendarInvite && (
                            <span className="flex items-center gap-1 text-[10px] text-blue-700 font-semibold bg-blue-50 border border-blue-200/80 px-1.5 py-0.5 rounded shadow-2xs">
                              <Calendar className="w-2.5 h-2.5 text-blue-600" />
                              <span>Invitation</span>
                            </span>
                          )}
                          {msg.hasAttachments && !msg.hasCalendarInvite && (
                            <span className="flex items-center gap-0.5 text-[10px] text-slate-500 font-medium bg-slate-100 px-1.5 py-0.5 rounded">
                              <Paperclip className="w-2.5 h-2.5" />
                              <span>Attachment</span>
                            </span>
                          )}
                          {msg.hasAttachments && msg.hasCalendarInvite && (
                            <span className="flex items-center gap-0.5 text-[10px] text-slate-500 font-medium bg-slate-100 px-1.5 py-0.5 rounded" title="Has attachments">
                              <Paperclip className="w-2.5 h-2.5" />
                            </span>
                          )}
                          {!selectedAccountId && (
                            <span className="text-[10px] text-slate-400 truncate max-w-[120px]">
                              {msg.account?.label || msg.account?.emailAddress || ""}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* ===================================================================== */}
          {/* RIGHT PANE: MESSAGE DETAIL */}
          {/* ===================================================================== */}
          <div className="flex-1 flex flex-col bg-white overflow-hidden">
            {!selectedMessageId ? (
              <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-3">
                <Mail className="w-12 h-12 text-slate-200 stroke-1" />
                <p className="text-sm font-medium text-slate-500">Select an email to read</p>
                <button
                  onClick={() => {
                    setComposerInitialBody("");
                    setComposerMode("new");
                    setIsComposerOpen(true);
                  }}
                  className="px-3.5 py-1.5 text-xs font-semibold text-blue-600 border border-blue-200 hover:bg-blue-50 rounded-lg transition-colors"
                >
                  Compose a new email
                </button>
              </div>
            ) : !activeDisplayMessage ? (
              <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-2">
                {isLoadingDetail ? (
                  <>
                    <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
                    <span className="text-xs">Loading message...</span>
                  </>
                ) : (
                  <span className="text-xs">Select an email to read</span>
                )}
              </div>
            ) : (
              /* FULL MESSAGE VIEW */
              <div className="flex flex-col h-full overflow-hidden">
                {isLoadingDetail && (
                  <div className="h-0.5 bg-blue-600 animate-pulse w-full shrink-0" />
                )}
                {/* Action Bar Header */}
                <div className="flex items-center justify-between px-6 py-3 border-b border-slate-200 bg-white">
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => {
                        setComposerInitialBody(quickReplyText);
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
                        setComposerInitialBody(quickReplyText);
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
                        setComposerInitialBody(quickReplyText);
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
                      onClick={() => handleToggleRead(activeDisplayMessage.id, activeDisplayMessage.isRead)}
                      className="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors"
                      title={activeDisplayMessage.isRead ? "Mark as unread" : "Mark as read"}
                    >
                      {activeDisplayMessage.isRead ? <Mail className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>

                    <button
                      onClick={() => handleToggleStar(activeDisplayMessage.id, activeDisplayMessage.isStarred)}
                      className="p-1.5 text-slate-500 hover:text-amber-500 hover:bg-slate-100 rounded-lg transition-colors"
                      title={activeDisplayMessage.isStarred ? "Unstar" : "Star message"}
                    >
                      <Star
                        className={`w-4 h-4 ${
                          activeDisplayMessage.isStarred ? "text-amber-500 fill-amber-500" : ""
                        }`}
                      />
                    </button>

                    <button
                      onClick={() => handleArchiveMessage(activeDisplayMessage.id)}
                      className="p-1.5 text-slate-500 hover:text-purple-600 hover:bg-purple-50 rounded-lg transition-colors"
                      title="Archive message"
                    >
                      <Archive className="w-4 h-4" />
                    </button>

                    <button
                      onClick={() => handleDeleteMessage(activeDisplayMessage.id)}
                      className="p-1.5 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                      title="Delete / Move to Trash"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="text-xs text-slate-400">
                    {format(parseISO(activeDisplayMessage.date), "PPP · p")}
                  </div>
                </div>

                {/* Email Content Container */}
                <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
                  {/* Subject and Thread Header */}
                  <div className="flex items-center justify-between pb-1 border-b border-slate-100">
                    <div className="flex items-center gap-2">
                      <h2 className="text-lg font-bold text-slate-900 tracking-tight">
                        {activeDisplayMessage.subject || "(No Subject)"}
                      </h2>
                      {displayThreadMessages.length > 1 && (
                        <span className="text-[11px] font-semibold px-2 py-0.5 bg-slate-100 text-slate-600 rounded-full border border-slate-200">
                          {displayThreadMessages.length} messages
                        </span>
                      )}
                    </div>
                    {displayThreadMessages.length > 1 && (
                      <button
                        type="button"
                        onClick={() => {
                          if (expandedMessageIds.size === displayThreadMessages.length) {
                            // Collapse all except latest
                            setExpandedMessageIds(new Set([displayThreadMessages[displayThreadMessages.length - 1].id]));
                          } else {
                            // Expand all
                            setExpandedMessageIds(new Set(displayThreadMessages.map((m) => m.id)));
                          }
                        }}
                        className="text-xs text-blue-600 hover:text-blue-800 font-medium transition-colors"
                      >
                        {expandedMessageIds.size === displayThreadMessages.length ? "Collapse all" : "Expand all"}
                      </button>
                    )}
                  </div>

                  {/* Privacy Banner for Tracking Protection */}
                  <div className={`p-3 border rounded-lg flex items-center justify-between text-xs transition-colors ${
                    isSenderTrusted
                      ? "bg-blue-50/80 border-blue-200 text-blue-900"
                      : "bg-amber-50/80 border-amber-200 text-amber-900"
                  }`}>
                    <div className="flex items-center gap-2">
                      {isSenderTrusted ? (
                        <ShieldCheck className="w-4 h-4 text-blue-600 shrink-0" />
                      ) : (
                        <Shield className="w-4 h-4 text-amber-600 shrink-0" />
                      )}
                      <span>
                        {isSenderTrusted ? (
                          <>
                            Remote images automatically loaded from trusted sender{" "}
                            <span className="font-semibold underline decoration-blue-300">{cleanSenderEmail}</span>.
                          </>
                        ) : loadRemoteImages ? (
                          "Remote images proxied through safe privacy gateway."
                        ) : (
                          "Remote images are blocked to prevent email senders from tracking you."
                        )}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {!loadRemoteImages ? (
                        <>
                          <button
                            onClick={() => setLoadRemoteImages(true)}
                            className="px-2.5 py-1 text-xs font-semibold text-amber-800 bg-amber-100 hover:bg-amber-200 rounded transition-colors"
                          >
                            Load Images
                          </button>
                          {cleanSenderEmail && (
                            <button
                              onClick={() => handleAlwaysLoadFromSender(cleanSenderEmail)}
                              className="px-2.5 py-1 text-xs font-semibold text-blue-700 bg-blue-100 hover:bg-blue-200 rounded transition-colors flex items-center gap-1"
                              title={`Always automatically load remote images from ${cleanSenderEmail}`}
                            >
                              <ShieldCheck className="w-3.5 h-3.5" />
                              <span>Always load images from this sender</span>
                            </button>
                          )}
                        </>
                      ) : isSenderTrusted ? (
                        <>
                          <button
                            onClick={() => handleRemoveTrustedSender(cleanSenderEmail)}
                            className="px-2.5 py-1 text-xs font-semibold text-slate-600 hover:text-rose-700 hover:bg-rose-50 rounded transition-colors"
                            title="Stop automatically loading images for this sender"
                          >
                            Stop auto-loading
                          </button>
                          <button
                            onClick={() => setLoadRemoteImages(false)}
                            className="px-2.5 py-1 text-xs font-semibold text-blue-800 bg-blue-100 hover:bg-blue-200 rounded transition-colors"
                          >
                            Hide Images
                          </button>
                        </>
                      ) : (
                        <>
                          {cleanSenderEmail && (
                            <button
                              onClick={() => handleAlwaysLoadFromSender(cleanSenderEmail)}
                              className="px-2.5 py-1 text-xs font-semibold text-blue-700 bg-blue-100 hover:bg-blue-200 rounded transition-colors flex items-center gap-1"
                              title={`Always automatically load remote images from ${cleanSenderEmail}`}
                            >
                              <ShieldCheck className="w-3.5 h-3.5" />
                              <span>Always load images from this sender</span>
                            </button>
                          )}
                          <button
                            onClick={() => setLoadRemoteImages(false)}
                            className="px-2.5 py-1 text-xs font-semibold text-amber-800 bg-amber-100 hover:bg-amber-200 rounded transition-colors"
                          >
                            Hide Images
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Conversation Thread Stack */}
                  {displayThreadMessages.length > 1 ? (
                    <div className="space-y-3">
                      {displayThreadMessages.map((msg) => {
                        const isExpanded = expandedMessageIds.has(msg.id);
                        const isFromMe = msg.fromAddress.toLowerCase() === msg.account.emailAddress.toLowerCase();

                        if (!isExpanded) {
                          return (
                            <div
                              key={msg.id}
                              onClick={() => setExpandedMessageIds((prev) => new Set(prev).add(msg.id))}
                              className="flex items-center justify-between p-3.5 bg-slate-50 hover:bg-slate-100/90 border border-slate-200 rounded-xl cursor-pointer transition-colors shadow-2xs"
                            >
                              <div className="flex items-center gap-3 overflow-hidden">
                                <div
                                  className={`w-7 h-7 rounded-full font-bold text-xs flex items-center justify-center shrink-0 ${
                                    isFromMe ? "bg-purple-100 text-purple-700" : "bg-blue-100 text-blue-700"
                                  }`}
                                >
                                  {isFromMe ? "Me" : (msg.fromName || msg.fromAddress).slice(0, 1).toUpperCase()}
                                </div>
                                <div className="flex items-center gap-2 overflow-hidden text-xs">
                                  <span className="font-bold text-slate-800 shrink-0">
                                    {isFromMe ? "Me" : (msg.fromName || msg.fromAddress)}
                                  </span>
                                  <span className="text-slate-500 truncate max-w-[400px]">
                                    {msg.snippet || "(No message body)"}
                                  </span>
                                </div>
                              </div>
                              <div className="flex items-center gap-3 shrink-0 text-xs text-slate-400">
                                {msg.hasAttachments && <Paperclip className="w-3.5 h-3.5 text-slate-400" />}
                                <span>{format(parseISO(msg.date), "MMM d, h:mm a")}</span>
                              </div>
                            </div>
                          );
                        }

                        return (
                          <div
                            key={msg.id}
                            className="border border-slate-200 rounded-xl bg-white shadow-2xs overflow-hidden"
                          >
                            {/* Expanded Card Header */}
                            <div
                              onClick={() => {
                                setExpandedMessageIds((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(msg.id)) next.delete(msg.id);
                                  else next.add(msg.id);
                                  return next;
                                });
                              }}
                              className="flex items-start justify-between p-4 bg-white border-b border-slate-100 cursor-pointer select-none hover:bg-slate-50/50 transition-colors"
                            >
                              <div className="flex items-start gap-3">
                                <div
                                  className={`w-8 h-8 rounded-full font-bold text-xs flex items-center justify-center shrink-0 ${
                                    isFromMe ? "bg-purple-100 text-purple-700" : "bg-blue-100 text-blue-700"
                                  }`}
                                >
                                  {isFromMe ? "Me" : (msg.fromName || msg.fromAddress).slice(0, 1).toUpperCase()}
                                </div>
                                <div>
                                  <div className="flex items-center gap-2">
                                    <span className="font-bold text-xs text-slate-900">
                                      {isFromMe ? "Me" : (msg.fromName || msg.fromAddress)}
                                    </span>
                                    <span className="text-slate-400 font-mono text-[11px]">
                                      &lt;{msg.fromAddress}&gt;
                                    </span>
                                    {msg.folder?.name && (
                                      <span className="text-[10px] font-medium text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
                                        {msg.folder.name}
                                      </span>
                                    )}
                                  </div>
                                  <div className="text-slate-500 text-[11px] mt-0.5">
                                    To: {msg.toAddresses}
                                  </div>
                                </div>
                              </div>

                              <div className="flex items-center gap-3 text-xs text-slate-400">
                                <span>{format(parseISO(msg.date), "PPP · p")}</span>
                                <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                                  <button
                                    onClick={() => {
                                      setFullMessage(msg);
                                      setComposerInitialBody(quickReplyText);
                                      setComposerMode("reply");
                                      setIsComposerOpen(true);
                                    }}
                                    className="p-1 hover:text-slate-700 rounded transition-colors"
                                    title="Reply to this message"
                                  >
                                    <Reply className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    onClick={() => handleToggleStar(msg.id, msg.isStarred)}
                                    className="p-1 hover:text-amber-500 rounded transition-colors"
                                    title={msg.isStarred ? "Unstar" : "Star message"}
                                  >
                                    <Star
                                      className={`w-3.5 h-3.5 ${
                                        msg.isStarred ? "text-amber-500 fill-amber-500" : ""
                                      }`}
                                    />
                                  </button>
                                  <button
                                    onClick={() => {
                                      setCalendarInitialDate(new Date(msg.date));
                                      setCurrentTab("calendar");
                                    }}
                                    className="p-1 hover:text-blue-600 rounded transition-colors"
                                    title="View schedule on your calendar for this date"
                                  >
                                    <Calendar className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </div>
                            </div>

                            {/* Message Body & Attachments */}
                            <div className="p-4 space-y-3">
                              {/* Attachments */}
                              {msg.attachments && msg.attachments.length > 0 && (
                                <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-2">
                                  <div className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                                    <Paperclip className="w-3.5 h-3.5" />
                                    <span>Attachments ({msg.attachments.length})</span>
                                  </div>
                                  <div className="flex flex-wrap gap-2">
                                    {msg.attachments.map((att) => (
                                      <div
                                        key={att.id}
                                        className="flex items-center gap-2 bg-white border border-slate-200 rounded px-2.5 py-1 text-xs text-slate-800 shadow-2xs"
                                      >
                                        <span className="font-medium max-w-[180px] truncate">{att.filename}</span>
                                        <span className="text-slate-400">({Math.round(att.size / 1024)} KB)</span>
                                        <a
                                          href={`/api/attachments/${att.id}`}
                                          download={att.filename}
                                          className="text-blue-600 hover:text-blue-800 p-0.5 rounded transition-colors"
                                          title="Download attachment"
                                        >
                                          <Download className="w-3.5 h-3.5" />
                                        </a>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {/* Calendar Event Invitation Banner */}
                              {msg.calendarInvite && (
                                <CalendarInviteBanner
                                  messageId={msg.id}
                                  invite={msg.calendarInvite}
                                  initialRsvpStatus={msg.userRsvpStatus}
                                  onCalendarUpdated={loadAccountsAndFolders}
                                  onNavigateToCalendar={(date) => {
                                    setCalendarInitialDate(new Date(date));
                                    setCurrentTab("calendar");
                                  }}
                                />
                              )}

                              {/* Sandboxed HTML Email Renderer */}
                              <MailRenderer
                                rawHtml={msg.bodyHtml}
                                bodyText={msg.bodyText}
                                loadRemoteImages={loadRemoteImages}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    /* Single Message View */
                    <div className="border border-slate-200 rounded-xl bg-white shadow-2xs overflow-hidden">
                      <div className="flex items-start justify-between p-4 bg-white border-b border-slate-100 text-xs">
                        <div className="flex items-start gap-3">
                          <div className="w-9 h-9 rounded-full bg-blue-100 text-blue-700 font-bold flex items-center justify-center shrink-0 text-sm">
                            {(activeDisplayMessage.fromName || activeDisplayMessage.fromAddress).slice(0, 1).toUpperCase()}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-slate-900">
                                {activeDisplayMessage.fromName || activeDisplayMessage.fromAddress}
                              </span>
                              <span className="text-slate-400 font-mono text-[11px]">
                                &lt;{activeDisplayMessage.fromAddress}&gt;
                              </span>
                            </div>
                            <div className="text-slate-500 text-[11px] mt-0.5">
                              To: {activeDisplayMessage.toAddresses}
                            </div>
                          </div>
                        </div>

                        <div className="text-right">
                          <span className="text-[11px] font-medium text-slate-500 px-2 py-0.5 bg-slate-100 rounded">
                            {activeDisplayMessage.account.label}
                          </span>
                        </div>
                      </div>

                      <div className="p-4 space-y-3">
                        {/* Attachments Strip */}
                        {activeDisplayMessage.attachments && activeDisplayMessage.attachments.length > 0 && (
                          <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                            <div className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                              <Paperclip className="w-3.5 h-3.5" />
                              <span>Attachments ({activeDisplayMessage.attachments.length})</span>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {activeDisplayMessage.attachments.map((att) => (
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

                        {/* Calendar Event Invitation Banner */}
                        {activeDisplayMessage.calendarInvite && (
                          <CalendarInviteBanner
                            messageId={activeDisplayMessage.id}
                            invite={activeDisplayMessage.calendarInvite}
                            initialRsvpStatus={activeDisplayMessage.userRsvpStatus}
                            onCalendarUpdated={loadAccountsAndFolders}
                            onNavigateToCalendar={(date) => {
                              setCalendarInitialDate(new Date(date));
                              setCurrentTab("calendar");
                            }}
                          />
                        )}

                        {/* Sandboxed HTML Email Renderer */}
                        <MailRenderer
                          rawHtml={activeDisplayMessage.bodyHtml}
                          bodyText={activeDisplayMessage.bodyText}
                          loadRemoteImages={loadRemoteImages}
                        />
                      </div>
                    </div>
                  )}

                  {/* Quick Reply Form at Bottom */}
                  <div className="pt-4 mt-6 border-t border-slate-200">
                    <form onSubmit={handleSendQuickReply} className="space-y-2">
                      <div className="flex items-center justify-between text-xs text-slate-500 font-semibold">
                        <span>
                          Quick Reply to{" "}
                          {(displayThreadMessages.length > 0
                            ? displayThreadMessages[displayThreadMessages.length - 1]
                            : activeDisplayMessage
                          ).fromName ||
                            (displayThreadMessages.length > 0
                              ? displayThreadMessages[displayThreadMessages.length - 1]
                              : activeDisplayMessage
                            ).fromAddress}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            const target =
                              displayThreadMessages.length > 0
                                ? displayThreadMessages[displayThreadMessages.length - 1]
                                : activeDisplayMessage;
                            setFullMessage(target);
                            setComposerInitialBody(quickReplyText);
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
                        placeholder={`Reply to ${(displayThreadMessages.length > 0 ? displayThreadMessages[displayThreadMessages.length - 1] : activeDisplayMessage).fromName || (displayThreadMessages.length > 0 ? displayThreadMessages[displayThreadMessages.length - 1] : activeDisplayMessage).fromAddress}...`}
                        className="w-full p-3 border border-slate-300 rounded-lg text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                      />
                      <div className="flex justify-between items-center">
                        <span className="text-[11px] text-slate-400">
                          Earlier message will be quoted below your reply
                        </span>
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
            loadMessages(true);
            loadTrustedSenders();
          }}
        />
      )}

      {/* Advanced Search Modal */}
      <AdvancedSearchModal
        isOpen={isAdvancedSearchOpen}
        onClose={() => setIsAdvancedSearchOpen(false)}
        currentQuery={searchQuery}
        onApplySearch={(q) => setSearchQuery(q)}
        currentView={currentView}
      />

      {/* Floating Resizable Compose Modal (~80% size, mouse adjustable) */}
      <ResizableComposerModal
        isOpen={isComposerOpen}
        title={
          composerMode === "reply"
            ? `Reply: ${displayThreadMessages[displayThreadMessages.length - 1]?.subject || activeDisplayMessage?.subject || "Email"}`
            : composerMode === "reply-all"
            ? `Reply All: ${displayThreadMessages[displayThreadMessages.length - 1]?.subject || activeDisplayMessage?.subject || "Email"}`
            : composerMode === "forward"
            ? `Forward: ${displayThreadMessages[displayThreadMessages.length - 1]?.subject || activeDisplayMessage?.subject || "Email"}`
            : "New Message"
        }
        onClose={() => {
          setIsComposerOpen(false);
          setComposerInitialBody("");
        }}
      >
        <MailComposer
          accounts={accounts}
          defaultAccountId={selectedAccountId || accounts[0]?.id}
          replyToMessage={
            composerMode !== "new"
              ? displayThreadMessages.length > 0
                ? displayThreadMessages[displayThreadMessages.length - 1]
                : activeDisplayMessage
              : null
          }
          mode={composerMode}
          initialBody={composerInitialBody}
          onClose={() => {
            setIsComposerOpen(false);
            setComposerInitialBody("");
          }}
          onSent={() => {
            setIsComposerOpen(false);
            setComposerInitialBody("");
            setQuickReplyText("");
            loadMessages(true);
            loadAccountsAndFolders();
            if (selectedMessageId) {
              fetch(`/api/messages/${selectedMessageId}`)
                .then((r) => (r.ok ? r.json() : null))
                .then((d) => {
                  if (d?.thread) {
                    setThreadMessages(d.thread);
                    setExpandedMessageIds(new Set(d.thread.map((m: any) => m.id)));
                  }
                });
            }
          }}
        />
      </ResizableComposerModal>
    </div>
    </ErrorBoundary>
  );
}
