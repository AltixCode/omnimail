"use client";

import React, { useState, useEffect } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import {
  Send,
  X,
  Paperclip,
  Bold,
  Italic,
  List,
  ListOrdered,
  Quote,
  Code,
  Link as LinkIcon,
  ChevronDown,
  ChevronUp,
  Trash2,
  Loader2,
} from "lucide-react";
import {
  buildQuotedHtml,
  buildQuotedPlaintext,
  formatQuoteDate,
  formatSenderString,
  sanitizeForQuoting,
  escapeHtml,
} from "@/lib/email-quote";

interface Account {
  id: string;
  label: string;
  emailAddress: string;
}

interface AttachmentItem {
  filename: string;
  contentType: string;
  size: number;
  content: string; // base64
}

interface MailComposerProps {
  accounts: Account[];
  defaultAccountId?: string;
  replyToMessage?: {
    id: string;
    messageId?: string | null;
    threadId?: string | null;
    subject?: string | null;
    fromAddress: string;
    fromName?: string | null;
    date: string | Date;
    bodyHtml?: string | null;
    bodyText?: string | null;
    toAddresses?: string;
    ccAddresses?: string | null;
  } | null;
  mode?: "new" | "reply" | "reply-all" | "forward";
  onClose: () => void;
  onSent?: () => void;
}

export function MailComposer({
  accounts,
  defaultAccountId,
  replyToMessage,
  mode = "new",
  onClose,
  onSent,
}: MailComposerProps) {
  const [selectedAccountId, setSelectedAccountId] = useState<string>(
    defaultAccountId || accounts[0]?.id || ""
  );
  const [toInput, setToInput] = useState<string>("");
  const [toChips, setToChips] = useState<string[]>([]);
  const [ccInput, setCcInput] = useState<string>("");
  const [ccChips, setCcChips] = useState<string[]>([]);
  const [bccInput, setBccInput] = useState<string>("");
  const [bccChips, setBccChips] = useState<string[]>([]);
  const [showCcBcc, setShowCcBcc] = useState<boolean>(false);
  const [subject, setSubject] = useState<string>("");
  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);
  const [isSending, setIsSending] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [includeQuote, setIncludeQuote] = useState<boolean>(true);
  const [showQuotedPreview, setShowQuotedPreview] = useState<boolean>(false);

  // Setup TipTap WYSIWYG editor
  const editor = useEditor({
    extensions: [
      StarterKit,
      Link.configure({
        openOnClick: false,
      }),
    ],
    content: "",
    editorProps: {
      attributes: {
        class:
          "prose prose-sm focus:outline-none min-h-[220px] max-h-[400px] overflow-y-auto px-4 py-3 text-slate-800",
      },
    },
    immediatelyRender: false,
  });

  // Handle reply / forward defaults
  useEffect(() => {
    if (!replyToMessage) return;

    if (mode === "reply" || mode === "reply-all") {
      setToChips([replyToMessage.fromAddress]);
      const cleanSubj = replyToMessage.subject || "";
      setSubject(cleanSubj.toLowerCase().startsWith("re:") ? cleanSubj : `Re: ${cleanSubj}`);
      setIncludeQuote(true);
      setShowQuotedPreview(false);

      if (mode === "reply-all" && replyToMessage.toAddresses) {
        try {
          const parsedTo = JSON.parse(replyToMessage.toAddresses);
          if (Array.isArray(parsedTo)) {
            const others = parsedTo.filter(
              (addr: string) => addr !== replyToMessage.fromAddress
            );
            setCcChips(others);
            if (others.length > 0) setShowCcBcc(true);
          }
        } catch {}
      }

      if (editor) {
        editor.commands.setContent("<p></p>");
        editor.commands.focus();
      }
    } else if (mode === "forward") {
      const cleanSubj = replyToMessage.subject || "";
      setSubject(cleanSubj.toLowerCase().startsWith("fwd:") ? cleanSubj : `Fwd: ${cleanSubj}`);

      if (editor) {
        const dateStr = formatQuoteDate(replyToMessage.date);
        const senderStr = formatSenderString(replyToMessage.fromName, replyToMessage.fromAddress);
        const inner = sanitizeForQuoting(replyToMessage.bodyHtml, replyToMessage.bodyText);
        const fwdHtml = `
          <p><br></p>
          <div class="gmail_quote">
            <div dir="ltr" class="gmail_attr" style="color: #64748b; font-size: 12px; margin-bottom: 6px;">
              ---------- Forwarded message ---------<br>
              <b>From:</b> ${escapeHtml(senderStr)}<br>
              <b>Date:</b> ${dateStr}<br>
              <b>Subject:</b> ${escapeHtml(replyToMessage.subject || "")}<br>
            </div>
            <blockquote class="gmail_quote" style="margin: 0 0 0 0.8ex; border-left: 2px solid #cbd5e1; padding-left: 10px; color: #475569;">
              ${inner}
            </blockquote>
          </div>
        `;
        editor.commands.setContent(fwdHtml);
        editor.commands.focus("start");
      }
    }
  }, [replyToMessage, mode, editor]);

  const handleAddChip = (
    type: "to" | "cc" | "bcc",
    inputVal: string,
    setInput: (v: string) => void,
    chips: string[],
    setChips: (c: string[]) => void
  ) => {
    const trimmed = inputVal.trim().replace(/,/g, "");
    if (trimmed && !chips.includes(trimmed)) {
      setChips([...chips, trimmed]);
      setInput("");
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const reader = new FileReader();
      reader.onload = () => {
        const base64Content = (reader.result as string).split(",")[1];
        setAttachments((prev) => [
          ...prev,
          {
            filename: file.name,
            contentType: file.type || "application/octet-stream",
            size: file.size,
            content: base64Content,
          },
        ]);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSend = async () => {
    setErrorMsg(null);
    let finalTo = [...toChips];
    if (toInput.trim()) {
      finalTo.push(toInput.trim().replace(/,/g, ""));
    }

    if (finalTo.length === 0) {
      setErrorMsg("Please specify at least one recipient (To)");
      return;
    }

    if (!subject.trim()) {
      setErrorMsg("Please enter a subject");
      return;
    }

    setIsSending(true);

    try {
      let htmlContent = editor?.getHTML() || "";
      let textContent = editor?.getText() || "";

      if (replyToMessage && (mode === "reply" || mode === "reply-all") && includeQuote) {
        const quotedHtml = buildQuotedHtml(replyToMessage);
        const quotedText = buildQuotedPlaintext(replyToMessage);
        htmlContent = `${htmlContent}<br>${quotedHtml}`;
        textContent = `${textContent}${quotedText}`;
      }

      const res = await fetch("/api/messages/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId: selectedAccountId,
          to: finalTo,
          cc: ccChips.length > 0 ? ccChips : undefined,
          bcc: bccChips.length > 0 ? bccChips : undefined,
          subject,
          bodyHtml: htmlContent,
          bodyText: textContent,
          inReplyTo: replyToMessage?.messageId || undefined,
          references: replyToMessage?.messageId || replyToMessage?.threadId || undefined,
          threadId: replyToMessage?.threadId || replyToMessage?.messageId || undefined,
          attachments: attachments.length > 0 ? attachments : undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to send email");
      }

      onSent?.();
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to send email");
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-white border border-slate-200 rounded-lg shadow-xl overflow-hidden">
      {/* Header bar */}
      <div className="flex items-center justify-between px-4 py-3 bg-slate-900 text-white">
        <h3 className="text-sm font-semibold tracking-wide">
          {mode === "reply"
            ? "Reply"
            : mode === "reply-all"
            ? "Reply All"
            : mode === "forward"
            ? "Forward Email"
            : "New Message"}
        </h3>
        <button
          onClick={onClose}
          className="text-slate-400 hover:text-white transition-colors"
          title="Close composer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {errorMsg && (
        <div className="px-4 py-2 bg-red-50 border-b border-red-200 text-xs text-red-600 font-medium">
          {errorMsg}
        </div>
      )}

      {/* Recipient & Account selectors */}
      <div className="px-4 py-2 border-b border-slate-100 space-y-2 text-xs">
        {/* From Account */}
        <div className="flex items-center">
          <span className="w-16 text-slate-500 font-medium">From:</span>
          <select
            value={selectedAccountId}
            onChange={(e) => setSelectedAccountId(e.target.value)}
            className="flex-1 bg-transparent border-none text-slate-800 font-medium focus:ring-0 focus:outline-none cursor-pointer py-1"
          >
            {accounts.map((acc) => (
              <option key={acc.id} value={acc.id}>
                {acc.label} &lt;{acc.emailAddress}&gt;
              </option>
            ))}
          </select>
        </div>

        {/* To: Recipient chips */}
        <div className="flex items-center flex-wrap gap-1">
          <span className="w-16 text-slate-500 font-medium">To:</span>
          <div className="flex-1 flex flex-wrap items-center gap-1.5 min-h-[28px]">
            {toChips.map((chip, idx) => (
              <span
                key={idx}
                className="inline-flex items-center gap-1 bg-slate-100 text-slate-800 rounded px-2 py-0.5 text-xs border border-slate-200"
              >
                {chip}
                <button
                  type="button"
                  onClick={() => setToChips(toChips.filter((_, i) => i !== idx))}
                  className="hover:text-red-500"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
            <input
              type="email"
              value={toInput}
              onChange={(e) => setToInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === "," || e.key === "Tab") {
                  e.preventDefault();
                  handleAddChip("to", toInput, setToInput, toChips, setToChips);
                }
              }}
              onBlur={() => handleAddChip("to", toInput, setToInput, toChips, setToChips)}
              placeholder={toChips.length === 0 ? "recipients@example.com" : ""}
              className="flex-1 min-w-[140px] border-none bg-transparent focus:outline-none text-slate-800 text-xs py-0.5"
            />
          </div>
          <button
            type="button"
            onClick={() => setShowCcBcc(!showCcBcc)}
            className="text-slate-400 hover:text-slate-600 font-medium text-xs px-1"
          >
            {showCcBcc ? "Hide CC/BCC" : "Cc/Bcc"}
          </button>
        </div>

        {/* CC & BCC */}
        {showCcBcc && (
          <>
            <div className="flex items-center flex-wrap gap-1">
              <span className="w-16 text-slate-500 font-medium">Cc:</span>
              <div className="flex-1 flex flex-wrap items-center gap-1.5">
                {ccChips.map((chip, idx) => (
                  <span
                    key={idx}
                    className="inline-flex items-center gap-1 bg-slate-100 text-slate-800 rounded px-2 py-0.5 text-xs border border-slate-200"
                  >
                    {chip}
                    <button
                      type="button"
                      onClick={() => setCcChips(ccChips.filter((_, i) => i !== idx))}
                      className="hover:text-red-500"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
                <input
                  type="email"
                  value={ccInput}
                  onChange={(e) => setCcInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === ",") {
                      e.preventDefault();
                      handleAddChip("cc", ccInput, setCcInput, ccChips, setCcChips);
                    }
                  }}
                  onBlur={() => handleAddChip("cc", ccInput, setCcInput, ccChips, setCcChips)}
                  placeholder="Cc recipients..."
                  className="flex-1 min-w-[120px] border-none bg-transparent focus:outline-none text-slate-800 text-xs py-0.5"
                />
              </div>
            </div>

            <div className="flex items-center flex-wrap gap-1">
              <span className="w-16 text-slate-500 font-medium">Bcc:</span>
              <div className="flex-1 flex flex-wrap items-center gap-1.5">
                {bccChips.map((chip, idx) => (
                  <span
                    key={idx}
                    className="inline-flex items-center gap-1 bg-slate-100 text-slate-800 rounded px-2 py-0.5 text-xs border border-slate-200"
                  >
                    {chip}
                    <button
                      type="button"
                      onClick={() => setBccChips(bccChips.filter((_, i) => i !== idx))}
                      className="hover:text-red-500"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
                <input
                  type="email"
                  value={bccInput}
                  onChange={(e) => setBccInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === ",") {
                      e.preventDefault();
                      handleAddChip("bcc", bccInput, setBccInput, bccChips, setBccChips);
                    }
                  }}
                  onBlur={() => handleAddChip("bcc", bccInput, setBccInput, bccChips, setBccChips)}
                  placeholder="Bcc recipients..."
                  className="flex-1 min-w-[120px] border-none bg-transparent focus:outline-none text-slate-800 text-xs py-0.5"
                />
              </div>
            </div>
          </>
        )}

        {/* Subject */}
        <div className="flex items-center pt-1">
          <span className="w-16 text-slate-500 font-medium">Subject:</span>
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Subject line"
            className="flex-1 border-none bg-transparent focus:outline-none text-slate-900 font-medium text-xs py-0.5"
          />
        </div>
      </div>

      {/* Editor Formatting Toolbar */}
      {editor && (
        <div className="flex items-center gap-1 px-3 py-1.5 bg-slate-50 border-b border-slate-200 flex-wrap">
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleBold().run()}
            className={`p-1.5 rounded hover:bg-slate-200 transition-colors ${
              editor.isActive("bold") ? "bg-slate-300 font-bold" : ""
            }`}
            title="Bold"
          >
            <Bold className="w-3.5 h-3.5 text-slate-700" />
          </button>
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleItalic().run()}
            className={`p-1.5 rounded hover:bg-slate-200 transition-colors ${
              editor.isActive("italic") ? "bg-slate-300 font-bold" : ""
            }`}
            title="Italic"
          >
            <Italic className="w-3.5 h-3.5 text-slate-700" />
          </button>
          <div className="w-[1px] h-4 bg-slate-300 mx-1" />
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            className={`p-1.5 rounded hover:bg-slate-200 transition-colors ${
              editor.isActive("bulletList") ? "bg-slate-300" : ""
            }`}
            title="Bullet List"
          >
            <List className="w-3.5 h-3.5 text-slate-700" />
          </button>
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
            className={`p-1.5 rounded hover:bg-slate-200 transition-colors ${
              editor.isActive("orderedList") ? "bg-slate-300" : ""
            }`}
            title="Numbered List"
          >
            <ListOrdered className="w-3.5 h-3.5 text-slate-700" />
          </button>
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
            className={`p-1.5 rounded hover:bg-slate-200 transition-colors ${
              editor.isActive("blockquote") ? "bg-slate-300" : ""
            }`}
            title="Quote"
          >
            <Quote className="w-3.5 h-3.5 text-slate-700" />
          </button>
          <button
            type="button"
            onClick={() => editor.chain().focus().toggleCodeBlock().run()}
            className={`p-1.5 rounded hover:bg-slate-200 transition-colors ${
              editor.isActive("codeBlock") ? "bg-slate-300" : ""
            }`}
            title="Code Block"
          >
            <Code className="w-3.5 h-3.5 text-slate-700" />
          </button>
        </div>
      )}

      {/* Editor Content Body */}
      <div className="flex-1 overflow-y-auto min-h-[220px]">
        <EditorContent editor={editor} />
      </div>

      {/* Quoted Email Section (Gmail-Style Trimmed Content) */}
      {replyToMessage && (mode === "reply" || mode === "reply-all") && (
        <div className="border-t border-slate-200 bg-slate-50/70 px-4 py-2 text-xs select-none">
          {showQuotedPreview ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-slate-500 font-medium">
                <span className="flex items-center gap-1.5">
                  <Quote className="w-3.5 h-3.5 text-slate-400" />
                  <span>Quoted email from {replyToMessage.fromName || replyToMessage.fromAddress}</span>
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setIncludeQuote(!includeQuote)}
                    className={`text-[11px] font-medium px-2 py-0.5 rounded transition-colors ${
                      includeQuote
                        ? "text-emerald-700 bg-emerald-100/70 hover:bg-emerald-200/70"
                        : "text-slate-500 bg-slate-200/70 hover:bg-slate-300/70"
                    }`}
                  >
                    {includeQuote ? "Quote attached" : "Quote removed"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowQuotedPreview(false)}
                    className="p-1 text-slate-400 hover:text-slate-600 rounded"
                    title="Collapse preview"
                  >
                    <ChevronUp className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              {includeQuote && (
                <div className="border-l-2 border-slate-300 pl-3 py-1.5 max-h-40 overflow-y-auto bg-white rounded p-2.5 text-[11px] text-slate-600 space-y-1 shadow-2xs">
                  <p className="font-semibold text-slate-700 text-xs">
                    On {formatQuoteDate(replyToMessage.date)}, {formatSenderString(replyToMessage.fromName, replyToMessage.fromAddress)} wrote:
                  </p>
                  <div
                    dangerouslySetInnerHTML={{
                      __html: sanitizeForQuoting(replyToMessage.bodyHtml, replyToMessage.bodyText),
                    }}
                  />
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => setShowQuotedPreview(true)}
                className="flex items-center gap-2 text-slate-500 hover:text-slate-800 font-medium transition-colors group"
                title="Show quoted content"
              >
                <span className="px-1.5 py-0.5 bg-slate-200 group-hover:bg-slate-300 rounded font-bold text-[10px] tracking-widest text-slate-600">
                  ···
                </span>
                <span className="text-[11px]">
                  {includeQuote
                    ? `Quoted email (${replyToMessage.fromName || replyToMessage.fromAddress})`
                    : "Quote removed"}
                </span>
              </button>
              {includeQuote && (
                <span className="text-[10px] text-slate-400 font-normal">Will be quoted below reply</span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Attachment Pills */}
      {attachments.length > 0 && (
        <div className="px-4 py-2 bg-slate-50 border-t border-slate-200 flex flex-wrap gap-2">
          {attachments.map((att, idx) => (
            <div
              key={idx}
              className="flex items-center gap-1.5 bg-white border border-slate-200 rounded px-2.5 py-1 text-xs text-slate-700 shadow-sm"
            >
              <Paperclip className="w-3 h-3 text-slate-400" />
              <span className="max-w-[150px] truncate">{att.filename}</span>
              <span className="text-slate-400">({Math.round(att.size / 1024)} KB)</span>
              <button
                type="button"
                onClick={() => setAttachments(attachments.filter((_, i) => i !== idx))}
                className="text-slate-400 hover:text-red-500"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Bottom Actions Bar */}
      <div className="flex items-center justify-between px-4 py-3 bg-slate-50 border-t border-slate-200">
        <div className="flex items-center gap-2">
          <label className="cursor-pointer p-2 rounded-md hover:bg-slate-200 text-slate-600 transition-colors flex items-center gap-1 text-xs font-medium">
            <Paperclip className="w-4 h-4" />
            <span>Attach File</span>
            <input
              type="file"
              multiple
              onChange={handleFileUpload}
              className="hidden"
            />
          </label>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-xs text-slate-600 hover:text-slate-800 font-medium rounded-md hover:bg-slate-200 transition-colors"
          >
            Discard
          </button>
          <button
            type="button"
            disabled={isSending}
            onClick={handleSend}
            className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors shadow-sm disabled:opacity-50"
          >
            {isSending ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Sending...</span>
              </>
            ) : (
              <>
                <Send className="w-3.5 h-3.5" />
                <span>Send</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

export default MailComposer;
