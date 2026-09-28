"use client";

import React, { useState } from "react";
import { Mail, Lock, User as UserIcon, ShieldCheck, Loader2, AlertCircle } from "lucide-react";

interface AuthScreenProps {
  isSetup: boolean;
  onSuccess: () => void;
}

export function AuthScreen({ isSetup, onSuccess }: AuthScreenProps) {
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (isSetup) {
      if (password.length < 8) {
        setErrorMsg("Master password must be at least 8 characters long.");
        return;
      }
      if (password !== confirmPassword) {
        setErrorMsg("Passwords do not match.");
        return;
      }
    } else if (authMode === "register") {
      if (password.length < 6) {
        setErrorMsg("Password must be at least 6 characters long.");
        return;
      }
      if (password !== confirmPassword) {
        setErrorMsg("Passwords do not match.");
        return;
      }
    }

    setIsLoading(true);
    try {
      let endpoint = "/api/auth/login";
      let payload: any = { email, password };

      if (isSetup) {
        endpoint = "/api/auth/setup";
        payload = { email, name, password };
      } else if (authMode === "register") {
        endpoint = "/api/auth/register";
        payload = { email, name, password };
      }

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Authentication failed");
      }

      onSuccess();
    } catch (err: any) {
      setErrorMsg(err.message || "An error occurred during authentication.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-screen bg-slate-950 flex flex-col justify-center items-center p-4 select-none">
      {/* Background ambient gradient glow */}
      <div className="absolute inset-0 bg-radial from-blue-900/20 via-slate-950 to-slate-950 pointer-events-none" />

      <div className="relative w-full max-w-md bg-slate-900/90 border border-slate-800 rounded-2xl p-8 shadow-2xl backdrop-blur-xl animate-in fade-in-50 zoom-in-95">
        {/* Brand Header */}
        <div className="flex flex-col items-center text-center mb-6">
          <div className="w-12 h-12 rounded-xl bg-blue-600 flex items-center justify-center text-white shadow-lg shadow-blue-500/20 mb-3 font-bold text-lg tracking-wider">
            OM
          </div>
          <h1 className="text-xl font-bold text-white tracking-tight">
            {isSetup
              ? "Create Master Admin Account"
              : authMode === "login"
              ? "Sign in to OmniMail"
              : "Create OmniMail Account"}
          </h1>
          <p className="text-xs text-slate-400 mt-1 max-w-xs">
            {isSetup
              ? "Welcome to your self-hosted webmail & CalDAV client. Configure your master admin credentials to get started."
              : authMode === "login"
              ? "Access your unified inbox, calendars, and synced mail accounts."
              : "Register a user account to aggregate your email accounts."}
          </p>
        </div>

        {/* Aggregator Notice Callout */}
        <div className="mb-5 p-3 bg-blue-950/40 border border-blue-800/50 rounded-xl text-[11px] text-blue-200/90 flex items-start gap-2.5 leading-relaxed">
          <ShieldCheck className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold text-blue-200">Email Aggregator Notice: </span>
            OmniMail is a client & aggregator, not an email host. We don&apos;t provide @omnimail email addresses. You connect your existing mailboxes (Gmail, Fastmail, iCloud, custom IMAP/SMTP) to read and manage all your mail in one place.
          </div>
        </div>

        {/* Tab switcher when not in master setup */}
        {!isSetup && (
          <div className="flex bg-slate-800/80 p-1 rounded-xl mb-5 border border-slate-700/60">
            <button
              type="button"
              onClick={() => {
                setAuthMode("login");
                setErrorMsg(null);
              }}
              className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                authMode === "login"
                  ? "bg-blue-600 text-white shadow-xs"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => {
                setAuthMode("register");
                setErrorMsg(null);
              }}
              className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-colors ${
                authMode === "register"
                  ? "bg-blue-600 text-white shadow-xs"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              Register
            </button>
          </div>
        )}

        {errorMsg && (
          <div className="mb-5 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-xs text-red-400 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
            <span>{errorMsg}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          {(isSetup || authMode === "register") && (
            <div>
              <label className="block text-slate-300 font-semibold mb-1.5">Your Name</label>
              <div className="relative">
                <UserIcon className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
                <input
                  type="text"
                  required={isSetup}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={isSetup ? "Administrator" : "Full Name (Optional)"}
                  className="w-full pl-9 pr-3 py-2 bg-slate-800/80 border border-slate-700 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                />
              </div>
            </div>
          )}

          <div>
            <label className="block text-slate-300 font-semibold mb-1.5">Email Address</label>
            <div className="relative">
              <Mail className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full pl-9 pr-3 py-2 bg-slate-800/80 border border-slate-700 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
              />
            </div>
          </div>

          <div>
            <label className="block text-slate-300 font-semibold mb-1.5">
              {isSetup ? "Master Password" : "Password"}
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                className="w-full pl-9 pr-3 py-2 bg-slate-800/80 border border-slate-700 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
              />
            </div>
            {(isSetup || authMode === "register") && (
              <span className="text-[10px] text-slate-500 mt-1 block">
                {isSetup ? "Must be at least 8 characters." : "Must be at least 6 characters."}
              </span>
            )}
          </div>

          {(isSetup || authMode === "register") && (
            <div>
              <label className="block text-slate-300 font-semibold mb-1.5">Confirm Password</label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
                <input
                  type="password"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="••••••••••••"
                  className="w-full pl-9 pr-3 py-2 bg-slate-800/80 border border-slate-700 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                />
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading}
            className="w-full mt-2 py-2.5 px-4 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-xl shadow-lg shadow-blue-600/30 transition-all flex items-center justify-center gap-2 disabled:opacity-50 active:scale-[0.99]"
          >
            {isLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : isSetup ? (
              <>
                <ShieldCheck className="w-4 h-4" />
                <span>Initialize OmniMail Admin</span>
              </>
            ) : authMode === "register" ? (
              <span>Create Account</span>
            ) : (
              <span>Sign In</span>
            )}
          </button>
        </form>

        <div className="mt-8 pt-6 border-t border-slate-800 text-center text-[11px] text-slate-500">
          OmniMail Self-Hosted Webmail & CalDAV Client
        </div>
      </div>
    </div>
  );
}

export default AuthScreen;
