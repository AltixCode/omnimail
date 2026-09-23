"use client";

import React, { useState, useEffect } from "react";
import {
  X,
  Plus,
  Trash2,
  CheckCircle,
  AlertCircle,
  Loader2,
  Server,
  Mail,
  Calendar,
  ShieldCheck,
  RefreshCw,
  Pencil,
  Bell,
  BellRing,
  Volume2,
  VolumeX,
  Info,
  Check,
} from "lucide-react";
import { playChime } from "@/hooks/useLiveStream";

interface Account {
  id: string;
  label: string;
  emailAddress: string;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  imapUser?: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser?: string;
  caldavUrl?: string | null;
  caldavUser?: string | null;
  syncActive: boolean;
  syncStatus?: string | null;
  lastSyncAt?: string | null;
  lastError?: string | null;
}

interface AccountModalProps {
  accounts: Account[];
  onClose: () => void;
  onRefresh: () => void;
  initialTab?: "list" | "add" | "notifications";
}

export function AccountModal({ accounts, onClose, onRefresh, initialTab = "list" }: AccountModalProps) {
  const [activeTab, setActiveTab] = useState<"list" | "add" | "notifications">(initialTab);
  const [editingAccountId, setEditingAccountId] = useState<string | null>(null);
  const [syncingAccountId, setSyncingAccountId] = useState<string | null>(null);
  const [testingAccountId, setTestingAccountId] = useState<string | null>(null);
  const [accountTestResults, setAccountTestResults] = useState<Record<string, {
    success: boolean;
    imap: { ok: boolean; error?: string | null };
    smtp: { ok: boolean; error?: string | null };
  }>>({});
  const [isTesting, setIsTesting] = useState<boolean>(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    imap: { ok: boolean; error?: string | null };
    smtp: { ok: boolean; error?: string | null };
  } | null>(null);

  // Notification & Audio States
  const [notifPermission, setNotifPermission] = useState<NotificationPermission>(() => {
    return typeof window !== "undefined" && "Notification" in window ? Notification.permission : "default";
  });
  const [soundEnabled, setSoundEnabled] = useState<boolean>(() => {
    return typeof window !== "undefined" ? localStorage.getItem("omnimail_sound_enabled") !== "false" : true;
  });
  const [previewEnabled, setPreviewEnabled] = useState<boolean>(() => {
    return typeof window !== "undefined" ? localStorage.getItem("omnimail_preview_enabled") !== "false" : true;
  });
  const [testSent, setTestSent] = useState<boolean>(false);

  // New Account Form
  const [label, setLabel] = useState<string>("");
  const [emailAddress, setEmailAddress] = useState<string>("");
  const [imapHost, setImapHost] = useState<string>("");
  const [imapPort, setImapPort] = useState<number>(993);
  const [imapSecure, setImapSecure] = useState<boolean>(true);
  const [imapUser, setImapUser] = useState<string>("");
  const [imapPassword, setImapPassword] = useState<string>("");

  const [smtpHost, setSmtpHost] = useState<string>("");
  const [smtpPort, setSmtpPort] = useState<number>(587);
  const [smtpSecure, setSmtpSecure] = useState<boolean>(false);
  const [smtpUser, setSmtpUser] = useState<string>("");
  const [smtpPassword, setSmtpPassword] = useState<string>("");

  const [includeCaldav, setIncludeCaldav] = useState<boolean>(false);
  const [caldavUrl, setCaldavUrl] = useState<string>("");
  const [caldavUser, setCaldavUser] = useState<string>("");
  const [caldavPassword, setCaldavPassword] = useState<string>("");

  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const resetForm = () => {
    setEditingAccountId(null);
    setLabel("");
    setEmailAddress("");
    setImapHost("");
    setImapPort(993);
    setImapSecure(true);
    setImapUser("");
    setImapPassword("");
    setSmtpHost("");
    setSmtpPort(465);
    setSmtpSecure(true);
    setSmtpUser("");
    setSmtpPassword("");
    setIncludeCaldav(false);
    setCaldavUrl("");
    setCaldavUser("");
    setCaldavPassword("");
    setTestResult(null);
    setErrorMsg(null);
  };

  const handleEditAccount = (acc: Account) => {
    setEditingAccountId(acc.id);
    setLabel(acc.label || "");
    setEmailAddress(acc.emailAddress || "");
    setImapHost(acc.imapHost || "");
    setImapPort(acc.imapPort || 993);
    setImapSecure(acc.imapSecure ?? true);
    setImapUser(acc.imapUser || acc.emailAddress || "");
    setImapPassword("");
    setSmtpHost(acc.smtpHost || "");
    setSmtpPort(acc.smtpPort || 465);
    setSmtpSecure(acc.smtpSecure ?? true);
    setSmtpUser(acc.smtpUser || acc.emailAddress || "");
    setSmtpPassword("");
    setIncludeCaldav(Boolean(acc.caldavUrl));
    setCaldavUrl(acc.caldavUrl || "");
    setCaldavUser(acc.caldavUser || acc.emailAddress || "");
    setCaldavPassword("");
    setTestResult(null);
    setErrorMsg(null);
    setActiveTab("add");
  };

  const handleManualSync = async (accId: string) => {
    setSyncingAccountId(accId);
    try {
      await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId: accId }),
      });
      onRefresh();
    } catch (e) {
      console.error("Manual sync failed:", e);
    } finally {
      setSyncingAccountId(null);
    }
  };

  const handleTestAccount = async (accId: string) => {
    setTestingAccountId(accId);
    try {
      const res = await fetch("/api/accounts/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId: accId }),
      });
      const data = await res.json();
      setAccountTestResults((prev) => ({ ...prev, [accId]: data }));
    } catch (err: any) {
      setAccountTestResults((prev) => ({
        ...prev,
        [accId]: {
          success: false,
          imap: { ok: false, error: err.message },
          smtp: { ok: false, error: err.message },
        },
      }));
    } finally {
      setTestingAccountId(null);
    }
  };

  // Preset quick fill
  const applyPreset = (preset: "fastmail" | "gmail" | "icloud" | "purelymail" | "custom") => {
    if (preset === "fastmail") {
      setImapHost("imap.fastmail.com");
      setImapPort(993);
      setImapSecure(true);
      setSmtpHost("smtp.fastmail.com");
      setSmtpPort(465);
      setSmtpSecure(true);
      setCaldavUrl("https://caldav.fastmail.com/dav/");
      setIncludeCaldav(true);
    } else if (preset === "purelymail") {
      setImapHost("imap.purelymail.com");
      setImapPort(993);
      setImapSecure(true);
      setSmtpHost("smtp.purelymail.com");
      setSmtpPort(587);
      setSmtpSecure(false);
      setCaldavUrl("https://purelymail.com/dav/");
      setIncludeCaldav(false);
    } else if (preset === "gmail") {
      setImapHost("imap.gmail.com");
      setImapPort(993);
      setImapSecure(true);
      setSmtpHost("smtp.gmail.com");
      setSmtpPort(587);
      setSmtpSecure(false);
      setCaldavUrl("https://apidata.googleusercontent.com/caldav/v2/");
    } else if (preset === "icloud") {
      setImapHost("imap.mail.me.com");
      setImapPort(993);
      setImapSecure(true);
      setSmtpHost("smtp.mail.me.com");
      setSmtpPort(587);
      setSmtpSecure(false);
      setCaldavUrl("https://caldav.icloud.com/");
    }
  };

  const handleTestConnection = async () => {
    if (!imapPassword) {
      setErrorMsg("Please enter account password above to test live authentication.");
      return;
    }
    setIsTesting(true);
    setTestResult(null);
    setErrorMsg(null);

    try {
      const res = await fetch("/api/accounts/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imapHost,
          imapPort,
          imapSecure,
          imapUser: imapUser || emailAddress,
          imapPassword,
          smtpHost,
          smtpPort,
          smtpSecure,
          smtpUser: smtpUser || emailAddress,
          smtpPassword: smtpPassword || imapPassword,
        }),
      });

      const data = await res.json();
      setTestResult(data);
    } catch (err: any) {
      setErrorMsg("Failed to test connection: " + err.message);
    } finally {
      setIsTesting(false);
    }
  };

  const handleSaveAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setErrorMsg(null);

    try {
      if (editingAccountId) {
        // Edit mode - PATCH
        const updatePayload: any = {
          label: label || emailAddress,
          emailAddress,
          imapHost,
          imapPort: Number(imapPort),
          imapSecure: Boolean(imapSecure),
          imapUser: imapUser || emailAddress,
          smtpHost,
          smtpPort: Number(smtpPort),
          smtpSecure: Boolean(smtpSecure),
          smtpUser: smtpUser || emailAddress,
          caldavUrl: includeCaldav ? (caldavUrl || null) : null,
          caldavUser: includeCaldav ? (caldavUser || emailAddress) : null,
        };

        if (imapPassword) updatePayload.imapPassword = imapPassword;
        if (smtpPassword) updatePayload.smtpPassword = smtpPassword;
        if (includeCaldav && caldavPassword) updatePayload.caldavPassword = caldavPassword;

        const res = await fetch(`/api/accounts/${editingAccountId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updatePayload),
        });

        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || "Failed to update account");
        }
      } else {
        // Create mode - POST
        const res = await fetch("/api/accounts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            label: label || emailAddress,
            emailAddress,
            imapHost,
            imapPort: Number(imapPort),
            imapSecure: Boolean(imapSecure),
            imapUser: imapUser || emailAddress,
            imapPassword,
            smtpHost,
            smtpPort: Number(smtpPort),
            smtpSecure: Boolean(smtpSecure),
            smtpUser: smtpUser || emailAddress,
            smtpPassword: smtpPassword || imapPassword,
            caldavUrl: includeCaldav ? caldavUrl : undefined,
            caldavUser: includeCaldav ? (caldavUser || emailAddress) : undefined,
            caldavPassword: includeCaldav ? (caldavPassword || imapPassword) : undefined,
          }),
        });

        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || "Failed to add account");
        }
      }

      resetForm();
      onRefresh();
      setActiveTab("list");
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to save account");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteAccount = async (id: string, email: string) => {
    if (!confirm(`Are you sure you want to remove account ${email}? All cached emails will be removed.`)) {
      return;
    }

    try {
      await fetch(`/api/accounts/${id}`, { method: "DELETE" });
      onRefresh();
    } catch (err) {
      console.error("Error deleting account:", err);
    }
  };

  const handleRequestPermission = async () => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    try {
      const perm = await Notification.requestPermission();
      setNotifPermission(perm);
      if (perm === "granted") {
        new Notification("OmniMail Notifications Active", {
          body: "Desktop alerts will notify you instantly when new emails arrive.",
          icon: "/icon.svg",
        });
        if (soundEnabled) {
          playChime();
        }
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleSendTestNotification = () => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission !== "granted") {
      handleRequestPermission();
      return;
    }
    try {
      new Notification("OmniMail Test Notification", {
        body: previewEnabled
          ? "Desktop notifications and audio alerts are verified and working!"
          : "New email received in OmniMail.",
        icon: "/icon.svg",
      });
      if (soundEnabled) {
        playChime();
      }
      setTestSent(true);
      setTimeout(() => setTestSent(false), 3000);
    } catch (e) {
      console.error("Test notification error:", e);
    }
  };

  const toggleSound = () => {
    const next = !soundEnabled;
    setSoundEnabled(next);
    localStorage.setItem("omnimail_sound_enabled", String(next));
    if (next) playChime();
  };

  const togglePreview = () => {
    const next = !previewEnabled;
    setPreviewEnabled(next);
    localStorage.setItem("omnimail_preview_enabled", String(next));
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl border border-slate-200 max-w-2xl w-full max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in-50 zoom-in-95">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-900 text-white">
          <div className="flex items-center gap-2">
            <Mail className="w-5 h-5 text-blue-400" />
            <h3 className="text-base font-bold">Mail & Calendar Accounts</h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Switcher */}
        <div className="flex border-b border-slate-200 bg-slate-50 px-6 pt-2">
          <button
            onClick={() => {
              resetForm();
              setActiveTab("list");
            }}
            className={`pb-2.5 px-4 text-xs font-semibold border-b-2 transition-colors ${
              activeTab === "list"
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            Connected Accounts ({accounts.length})
          </button>
          <button
            onClick={() => {
              if (!editingAccountId) {
                resetForm();
              }
              setActiveTab("add");
            }}
            className={`pb-2.5 px-4 text-xs font-semibold border-b-2 transition-colors flex items-center gap-1.5 ${
              activeTab === "add"
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            {editingAccountId ? (
              <>
                <Pencil className="w-3.5 h-3.5" />
                <span>Edit Account</span>
              </>
            ) : (
              <>
                <Plus className="w-3.5 h-3.5" />
                <span>Add Account</span>
              </>
            )}
          </button>
          <button
            onClick={() => {
              resetForm();
              setActiveTab("notifications");
            }}
            className={`pb-2.5 px-4 text-xs font-semibold border-b-2 transition-colors flex items-center gap-1.5 ${
              activeTab === "notifications"
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            <Bell className="w-3.5 h-3.5" />
            <span>Notifications & Sound</span>
          </button>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-6">
          {activeTab === "list" && (
            <div className="space-y-3">
              {accounts.length === 0 ? (
                <div className="text-center py-12">
                  <Server className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                  <h4 className="text-sm font-semibold text-slate-700">No accounts connected</h4>
                  <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                    Connect an IMAP/SMTP mail server or CalDAV calendar to start aggregating your messages and events.
                  </p>
                  <button
                    onClick={() => {
                      resetForm();
                      setActiveTab("add");
                    }}
                    className="mt-4 px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-sm"
                  >
                    Add your first account
                  </button>
                </div>
              ) : (
                accounts.map((acc) => (
                  <div
                    key={acc.id}
                    className="p-4 border border-slate-200 rounded-xl bg-white flex flex-col gap-2.5 hover:border-slate-300 transition-colors shadow-xs"
                  >
                    <div className="flex items-center justify-between">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-slate-900">{acc.label}</span>
                          <span className="text-xs text-slate-500 font-mono">
                            &lt;{acc.emailAddress}&gt;
                          </span>
                        </div>
                        <div className="flex items-center gap-4 text-xs text-slate-500">
                          <span>IMAP: {acc.imapHost}:{acc.imapPort}</span>
                          <span>SMTP: {acc.smtpHost}:{acc.smtpPort}</span>
                          {acc.caldavUrl && (
                            <span className="flex items-center gap-1 text-emerald-600 font-medium">
                              <Calendar className="w-3 h-3" /> CalDAV
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-[11px] text-slate-400 pt-1">
                          <span>Status: <strong className={acc.syncStatus === "error" ? "text-red-600 font-semibold" : "text-slate-600 font-medium"}>{acc.syncStatus || "idle"}</strong></span>
                          {acc.lastSyncAt && (
                            <span>· Last sync: {new Date(acc.lastSyncAt).toLocaleTimeString()}</span>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => handleTestAccount(acc.id)}
                          disabled={testingAccountId === acc.id}
                          className="px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:text-blue-700 bg-slate-50 hover:bg-blue-50 border border-slate-200 hover:border-blue-300 rounded-lg transition-colors flex items-center gap-1.5 disabled:opacity-50"
                          title="Test IMAP & SMTP connection using saved credentials"
                        >
                          {testingAccountId === acc.id ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-600" />
                          ) : (
                            <ShieldCheck className="w-3.5 h-3.5 text-blue-600" />
                          )}
                          <span>Test</span>
                        </button>
                        <button
                          onClick={() => handleManualSync(acc.id)}
                          disabled={syncingAccountId === acc.id}
                          className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors disabled:opacity-50"
                          title="Sync Account Now"
                        >
                          <RefreshCw className={`w-4 h-4 ${syncingAccountId === acc.id ? "animate-spin text-blue-600" : ""}`} />
                        </button>
                        <button
                          onClick={() => handleEditAccount(acc)}
                          className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                          title="Edit Account Settings"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDeleteAccount(acc.id, acc.emailAddress)}
                          className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                          title="Remove Account"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    {/* Inline Test Result */}
                    {accountTestResults[acc.id] && (
                      <div
                        className={`p-3 rounded-lg border text-xs space-y-1.5 ${
                          accountTestResults[acc.id].success
                            ? "bg-emerald-50/90 border-emerald-300"
                            : "bg-red-50/90 border-red-300"
                        }`}
                      >
                        <div
                          className={`flex items-start gap-1.5 font-bold ${
                            accountTestResults[acc.id].success ? "text-emerald-800" : "text-red-800"
                          }`}
                        >
                          {accountTestResults[acc.id].success ? (
                            <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                          ) : (
                            <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                          )}
                          <span>
                            {accountTestResults[acc.id].success
                              ? "Connection Verified: IMAP & SMTP authenticated successfully"
                              : "Connection Test Failed"}
                          </span>
                        </div>

                        {!accountTestResults[acc.id].imap.ok && (
                          <div className="text-[11px] text-red-800 pl-5 font-medium leading-relaxed">
                            <strong className="font-bold">IMAP:</strong> {accountTestResults[acc.id].imap.error}
                          </div>
                        )}

                        {!accountTestResults[acc.id].smtp.ok && (
                          <div className="text-[11px] text-red-800 pl-5 font-medium leading-relaxed">
                            <strong className="font-bold">SMTP:</strong> {accountTestResults[acc.id].smtp.error}
                          </div>
                        )}

                        {!accountTestResults[acc.id].success && (
                          <div className="pt-1 pl-5">
                            <button
                              type="button"
                              onClick={() => handleEditAccount(acc)}
                              className="text-xs font-bold text-blue-700 underline hover:text-blue-900"
                            >
                              Edit account settings or update password &rarr;
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Unresolved error notice if test hasn't been explicitly run */}
                    {!accountTestResults[acc.id] && acc.lastError && (
                      <div className="p-2.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700 flex items-center justify-between">
                        <div className="flex items-center gap-1.5 truncate pr-2">
                          <AlertCircle className="w-3.5 h-3.5 text-red-600 shrink-0" />
                          <span className="truncate">{acc.lastError}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleEditAccount(acc)}
                          className="text-[11px] font-bold text-red-800 underline hover:text-red-950 shrink-0"
                        >
                          Fix
                        </button>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          )}

          {activeTab === "add" && (
            /* ADD / EDIT ACCOUNT FORM */
            <form onSubmit={handleSaveAccount} className="space-y-4 text-xs">
              {editingAccountId && (
                <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl text-blue-900 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Pencil className="w-4 h-4 text-blue-600 shrink-0" />
                    <div>
                      <span className="font-bold">Editing Account:</span>{" "}
                      <span className="font-medium">{label || emailAddress}</span>
                    </div>
                  </div>
                  <span className="text-[11px] text-blue-700 bg-blue-100/90 px-2 py-0.5 rounded-full font-medium">
                    Passwords blank = keep current
                  </span>
                </div>
              )}

              {errorMsg && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 font-medium flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{errorMsg}</span>
                </div>
              )}

              {/* Provider Quick Presets */}
              <div>
                <label className="block text-slate-600 font-bold mb-1.5 uppercase tracking-wide text-[10px]">
                  Provider Presets
                </label>
                <div className="grid grid-cols-5 gap-2">
                  <button
                    type="button"
                    onClick={() => applyPreset("purelymail")}
                    className="px-2.5 py-2 border border-slate-200 rounded-lg hover:border-blue-500 text-slate-700 font-medium text-center hover:bg-blue-50/50 transition-colors"
                  >
                    Purelymail
                  </button>
                  <button
                    type="button"
                    onClick={() => applyPreset("fastmail")}
                    className="px-2.5 py-2 border border-slate-200 rounded-lg hover:border-blue-500 text-slate-700 font-medium text-center hover:bg-blue-50/50 transition-colors"
                  >
                    Fastmail
                  </button>
                  <button
                    type="button"
                    onClick={() => applyPreset("gmail")}
                    className="px-2.5 py-2 border border-slate-200 rounded-lg hover:border-blue-500 text-slate-700 font-medium text-center hover:bg-blue-50/50 transition-colors"
                  >
                    Gmail
                  </button>
                  <button
                    type="button"
                    onClick={() => applyPreset("icloud")}
                    className="px-2.5 py-2 border border-slate-200 rounded-lg hover:border-blue-500 text-slate-700 font-medium text-center hover:bg-blue-50/50 transition-colors"
                  >
                    iCloud
                  </button>
                  <button
                    type="button"
                    onClick={() => applyPreset("custom")}
                    className="px-2.5 py-2 border border-slate-200 rounded-lg hover:border-blue-500 text-slate-700 font-medium text-center hover:bg-blue-50/50 transition-colors"
                  >
                    Custom
                  </button>
                </div>
              </div>

              {/* Basic Info */}
              <div className="grid grid-cols-2 gap-3 pt-2">
                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Account Label</label>
                  <input
                    type="text"
                    required
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    placeholder="Work Mail, Personal..."
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Email Address *</label>
                  <input
                    type="email"
                    required
                    value={emailAddress}
                    onChange={(e) => {
                      setEmailAddress(e.target.value);
                      if (!imapUser) setImapUser(e.target.value);
                      if (!smtpUser) setSmtpUser(e.target.value);
                    }}
                    placeholder="user@example.com"
                    className="w-full px-3 py-1.5 border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              {/* IMAP SETTINGS */}
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
                <div className="font-bold text-slate-800 flex items-center gap-1.5">
                  <Server className="w-3.5 h-3.5 text-blue-600" />
                  <span>Incoming Mail (IMAP)</span>
                </div>

                {(emailAddress.includes("@gmail.com") || imapHost.includes("gmail.com")) && (
                  <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-lg text-amber-900 text-[11px] leading-relaxed">
                    <strong className="font-bold">Gmail App Password Required:</strong> Google requires a 16-character App Password (standard account passwords and 2FA will fail). Generate one at{" "}
                    <a
                      href="https://myaccount.google.com/apppasswords"
                      target="_blank"
                      rel="noreferrer"
                      className="underline font-bold text-amber-800 hover:text-amber-950"
                    >
                      myaccount.google.com/apppasswords
                    </a>.
                  </div>
                )}

                <div className="grid grid-cols-3 gap-2">
                  <div className="col-span-2">
                    <label className="block text-slate-600 mb-1">IMAP Host *</label>
                    <input
                      type="text"
                      required
                      value={imapHost}
                      onChange={(e) => setImapHost(e.target.value)}
                      placeholder="imap.example.com"
                      className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-slate-900 bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-600 mb-1">Port</label>
                    <input
                      type="number"
                      value={imapPort}
                      onChange={(e) => setImapPort(Number(e.target.value))}
                      className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-slate-900 bg-white"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-slate-600 mb-1">IMAP Username</label>
                    <input
                      type="text"
                      value={imapUser}
                      onChange={(e) => setImapUser(e.target.value)}
                      placeholder={emailAddress || "user@example.com"}
                      className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-slate-900 bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-600 mb-1">
                      IMAP Password {editingAccountId ? "(Optional)" : "*"}
                    </label>
                    <input
                      type="password"
                      required={!editingAccountId}
                      value={imapPassword}
                      onChange={(e) => setImapPassword(e.target.value)}
                      placeholder={editingAccountId ? "Leave blank to keep current password" : "••••••••••••"}
                      className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-slate-900 bg-white"
                    />
                  </div>
                </div>
              </div>

              {/* SMTP SETTINGS */}
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
                <div className="font-bold text-slate-800 flex items-center gap-1.5">
                  <Mail className="w-3.5 h-3.5 text-blue-600" />
                  <span>Outgoing Mail (SMTP)</span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="col-span-2">
                    <label className="block text-slate-600 mb-1">SMTP Host *</label>
                    <input
                      type="text"
                      required
                      value={smtpHost}
                      onChange={(e) => setSmtpHost(e.target.value)}
                      placeholder="smtp.example.com"
                      className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-slate-900 bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-600 mb-1">Port</label>
                    <input
                      type="number"
                      value={smtpPort}
                      onChange={(e) => setSmtpPort(Number(e.target.value))}
                      className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-slate-900 bg-white"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-slate-600 mb-1">SMTP Username</label>
                    <input
                      type="text"
                      value={smtpUser}
                      onChange={(e) => setSmtpUser(e.target.value)}
                      placeholder={emailAddress || "user@example.com"}
                      className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-slate-900 bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-600 mb-1">SMTP Password</label>
                    <input
                      type="password"
                      value={smtpPassword}
                      onChange={(e) => setSmtpPassword(e.target.value)}
                      placeholder={editingAccountId ? "Leave blank to keep current password" : "Leave blank to use IMAP password"}
                      className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-slate-900 bg-white"
                    />
                  </div>
                </div>
              </div>

              {/* CALDAV SETTINGS (Optional) */}
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                <div className="flex items-center justify-between">
                  <div className="font-bold text-slate-800 flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5 text-blue-600" />
                    <span>CalDAV Calendar Support</span>
                  </div>
                  <input
                    type="checkbox"
                    id="caldavToggle"
                    checked={includeCaldav}
                    onChange={(e) => setIncludeCaldav(e.target.checked)}
                    className="rounded text-blue-600 focus:ring-blue-500"
                  />
                </div>

                {includeCaldav && (
                  <div className="space-y-2 pt-2 border-t border-slate-200">
                    <div>
                      <label className="block text-slate-600 mb-1">CalDAV URL</label>
                      <input
                        type="url"
                        value={caldavUrl}
                        onChange={(e) => setCaldavUrl(e.target.value)}
                        placeholder="https://caldav.example.com/dav/"
                        className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-slate-900 bg-white"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Test Results Display */}
              {testResult && (
                <div className="p-3.5 rounded-xl border text-xs space-y-2 bg-slate-100/90 border-slate-300 shadow-xs">
                  <div className={`flex items-start gap-2 ${testResult.imap.ok ? "text-emerald-800" : "text-red-700"}`}>
                    {testResult.imap.ok ? (
                      <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                    ) : (
                      <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                    )}
                    <span className="leading-relaxed font-medium">
                      <strong className="font-bold">IMAP:</strong> {testResult.imap.ok ? "Connected & authenticated successfully" : testResult.imap.error}
                    </span>
                  </div>
                  <div className={`flex items-start gap-2 ${testResult.smtp.ok ? "text-emerald-800" : "text-red-700"}`}>
                    {testResult.smtp.ok ? (
                      <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                    ) : (
                      <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                    )}
                    <span className="leading-relaxed font-medium">
                      <strong className="font-bold">SMTP:</strong> {testResult.smtp.ok ? "Verified & authenticated successfully" : testResult.smtp.error}
                    </span>
                  </div>
                </div>
              )}

              {/* Form Buttons */}
              <div className="flex items-center justify-between pt-3 border-t border-slate-200">
                <button
                  type="button"
                  disabled={isTesting || !imapHost}
                  onClick={handleTestConnection}
                  className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors flex items-center gap-1.5 disabled:opacity-50"
                >
                  {isTesting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />}
                  <span>Test Connection</span>
                </button>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      resetForm();
                      setActiveTab("list");
                    }}
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
                    <span>{editingAccountId ? "Save Changes" : "Save & Sync"}</span>
                  </button>
                </div>
              </div>
            </form>
          )}

          {activeTab === "notifications" && (
            <div className="space-y-5 text-xs">
              {/* Permission Banner Card */}
              <div className="p-4 rounded-xl border bg-slate-50 border-slate-200 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Bell className="w-5 h-5 text-blue-600 shrink-0" />
                    <div>
                      <h4 className="text-sm font-bold text-slate-900">Desktop Push Notifications</h4>
                      <p className="text-[11px] text-slate-500">
                        Receive instant native notifications whenever a new email arrives in any connected inbox.
                      </p>
                    </div>
                  </div>
                  {notifPermission === "granted" ? (
                    <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200 flex items-center gap-1 shrink-0">
                      <CheckCircle className="w-3.5 h-3.5 text-emerald-600" />
                      Active
                    </span>
                  ) : notifPermission === "denied" ? (
                    <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-rose-100 text-rose-800 border border-rose-200 flex items-center gap-1 shrink-0">
                      <AlertCircle className="w-3.5 h-3.5 text-rose-600" />
                      Blocked in Browser
                    </span>
                  ) : (
                    <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-amber-100 text-amber-800 border border-amber-200 flex items-center gap-1 shrink-0">
                      <AlertCircle className="w-3.5 h-3.5 text-amber-600" />
                      Not Enabled
                    </span>
                  )}
                </div>

                {notifPermission === "denied" && (
                  <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-800 text-[11px] leading-relaxed">
                    <strong>Notifications are blocked:</strong> To re-enable them, click the padlock or site settings icon next to <code>webmail.altixcode.com</code> in your browser address bar, change <strong>Notifications</strong> to <strong>Allow</strong>, and refresh the page.
                  </div>
                )}

                {notifPermission !== "granted" && notifPermission !== "denied" && (
                  <div className="pt-2 flex items-center gap-3">
                    <button
                      type="button"
                      onClick={handleRequestPermission}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg text-xs transition-colors shadow-xs flex items-center gap-1.5"
                    >
                      <BellRing className="w-4 h-4" />
                      <span>Enable Desktop Notifications</span>
                    </button>
                    <span className="text-[11px] text-slate-500">
                      Your browser will display a permission prompt.
                    </span>
                  </div>
                )}

                {notifPermission === "granted" && (
                  <div className="pt-2 flex items-center gap-3">
                    <button
                      type="button"
                      onClick={handleSendTestNotification}
                      className="px-3.5 py-1.5 bg-white border border-slate-300 hover:bg-slate-100 text-slate-800 font-semibold rounded-lg text-xs transition-colors shadow-2xs flex items-center gap-1.5"
                    >
                      {testSent ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <BellRing className="w-3.5 h-3.5 text-blue-600" />}
                      <span>{testSent ? "Test Alert Dispatched!" : "Send Test Notification"}</span>
                    </button>
                    <span className="text-[11px] text-slate-500">
                      Dispatches a live browser notification and plays the chime.
                    </span>
                  </div>
                )}
              </div>

              {/* Sound & Chime Options */}
              <div className="p-4 rounded-xl border bg-white border-slate-200 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {soundEnabled ? (
                      <Volume2 className="w-4 h-4 text-blue-600 shrink-0" />
                    ) : (
                      <VolumeX className="w-4 h-4 text-slate-400 shrink-0" />
                    )}
                    <div>
                      <h4 className="font-bold text-slate-900">Audio Chime</h4>
                      <p className="text-[11px] text-slate-500">
                        Synthesizes a pleasant audio chime via Web Audio API whenever a new email lands.
                      </p>
                    </div>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={soundEnabled}
                      onChange={toggleSound}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
                  </label>
                </div>

                <div className="pt-1 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => playChime()}
                    className="px-3 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium rounded text-[11px] transition-colors flex items-center gap-1.5"
                  >
                    <Volume2 className="w-3.5 h-3.5 text-slate-500" />
                    <span>Play Sample Chime</span>
                  </button>
                </div>
              </div>

              {/* Notification Content Privacy */}
              <div className="p-4 rounded-xl border bg-white border-slate-200 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="font-bold text-slate-900">Email Previews in Popups</h4>
                    <p className="text-[11px] text-slate-500">
                      When enabled, alerts display the sender name, email subject, and preview snippet. If disabled for privacy, alerts will only indicate &quot;New email received&quot;.
                    </p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer ml-4 shrink-0">
                    <input
                      type="checkbox"
                      checked={previewEnabled}
                      onChange={togglePreview}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
                  </label>
                </div>
              </div>

              {/* Real-time Streaming Info */}
              <div className="p-3.5 rounded-xl border border-blue-100 bg-blue-50/60 text-blue-950 flex items-start gap-2.5">
                <Info className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                <div className="space-y-1 text-[11px] leading-relaxed">
                  <span className="font-bold">Always-On Live Streaming:</span>
                  <p className="text-slate-600">
                    OmniMail keeps open persistent IMAP IDLE connections and Server-Sent Events (SSE). New emails push directly to your browser without needing to refresh or poll manually.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default AccountModal;
