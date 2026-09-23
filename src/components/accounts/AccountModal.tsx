"use client";

import React, { useState } from "react";
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
} from "lucide-react";

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
}

interface AccountModalProps {
  accounts: Account[];
  onClose: () => void;
  onRefresh: () => void;
}

export function AccountModal({ accounts, onClose, onRefresh }: AccountModalProps) {
  const [activeTab, setActiveTab] = useState<"list" | "add">("list");
  const [isTesting, setIsTesting] = useState<boolean>(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    imap: { ok: boolean; error?: string | null };
    smtp: { ok: boolean; error?: string | null };
  } | null>(null);

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
      setSmtpPort(465);
      setSmtpSecure(true);
      setCaldavUrl("https://purelymail.com/dav/");
      setIncludeCaldav(false);
    } else if (preset === "gmail") {
      setImapHost("imap.gmail.com");
      setImapPort(993);
      setImapSecure(true);
      setSmtpHost("smtp.gmail.com");
      setSmtpPort(465);
      setSmtpSecure(true);
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
      const res = await fetch("/api/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: label || emailAddress,
          emailAddress,
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
          caldavUrl: includeCaldav ? caldavUrl : undefined,
          caldavUser: includeCaldav ? (caldavUser || emailAddress) : undefined,
          caldavPassword: includeCaldav ? (caldavPassword || imapPassword) : undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to add account");
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
            onClick={() => setActiveTab("list")}
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
              resetForm();
              setActiveTab("add");
            }}
            className={`pb-2.5 px-4 text-xs font-semibold border-b-2 transition-colors flex items-center gap-1.5 ${
              activeTab === "add"
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Account</span>
          </button>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-6">
          {activeTab === "list" ? (
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
                    className="p-4 border border-slate-200 rounded-xl bg-white flex items-center justify-between hover:border-slate-300 transition-colors shadow-xs"
                  >
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
                        <span>Status: <strong className="text-slate-600">{acc.syncStatus || "idle"}</strong></span>
                        {acc.lastSyncAt && (
                          <span>· Last sync: {new Date(acc.lastSyncAt).toLocaleTimeString()}</span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleDeleteAccount(acc.id, acc.emailAddress)}
                        className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        title="Remove Account"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          ) : (
            /* ADD ACCOUNT FORM */
            <form onSubmit={handleSaveAccount} className="space-y-4 text-xs">
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
                    <label className="block text-slate-600 mb-1">IMAP Password / App Password *</label>
                    <input
                      type="password"
                      required
                      value={imapPassword}
                      onChange={(e) => setImapPassword(e.target.value)}
                      placeholder="••••••••••••"
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
                      placeholder="Leave blank to use IMAP password"
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
                  disabled={isTesting || !imapHost || !imapPassword}
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
                    <span>Save & Sync</span>
                  </button>
                </div>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

export default AccountModal;
