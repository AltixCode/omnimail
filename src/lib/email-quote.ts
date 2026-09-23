import { format, parseISO } from "date-fns";

export interface QuotedMessage {
  fromAddress: string;
  fromName?: string | null;
  date: Date | string;
  bodyHtml?: string | null;
  bodyText?: string | null;
}

/**
 * Format date for email reply attribution header (e.g., "Wed, Sep 23, 2026 at 3:00 PM")
 */
export function formatQuoteDate(dateInput: Date | string): string {
  try {
    const d = typeof dateInput === "string" ? parseISO(dateInput) : dateInput;
    return format(d, "EEE, MMM d, yyyy 'at' h:mm a");
  } catch {
    return new Date(dateInput).toLocaleString();
  }
}

/**
 * Format sender string for quote header (e.g., "Jane Doe <jane@example.com>")
 */
export function formatSenderString(name?: string | null, address?: string): string {
  const addr = address || "unknown";
  if (name && name.trim() && name.trim().toLowerCase() !== addr.toLowerCase()) {
    return `${name.trim()} <${addr}>`;
  }
  return `<${addr}>`;
}

/**
 * Escape raw strings for HTML insertion
 */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Clean and extract inner HTML for safe embedding inside a blockquote
 */
export function sanitizeForQuoting(
  bodyHtml?: string | null,
  bodyText?: string | null
): string {
  if (bodyHtml && bodyHtml.trim()) {
    let clean = bodyHtml.trim();

    // Strip DOCTYPE and html wrappers if present
    clean = clean.replace(/<!DOCTYPE[^>]*>/gi, "");
    clean = clean.replace(/<html[^>]*>[\s\S]*?<body[^>]*>/gi, "");
    clean = clean.replace(/<\/body>[\s\S]*?<\/html>/gi, "");
    clean = clean.replace(/<head[^>]*>[\s\S]*?<\/head>/gi, "");
    clean = clean.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");
    clean = clean.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");

    return clean.trim();
  }

  if (bodyText && bodyText.trim()) {
    const escaped = escapeHtml(bodyText.trim());
    return `<p style="margin: 0; white-space: pre-wrap;">${escaped.replace(/\n/g, "<br>")}</p>`;
  }

  return `<p style="margin: 0; color: #94a3b8; font-style: italic;">(No message content)</p>`;
}

/**
 * Build Gmail-standard quoted HTML block for replies
 */
export function buildQuotedHtml(msg: QuotedMessage): string {
  const dateStr = formatQuoteDate(msg.date);
  const senderStr = formatSenderString(msg.fromName, msg.fromAddress);
  const innerHtml = sanitizeForQuoting(msg.bodyHtml, msg.bodyText);

  return `
<div class="gmail_quote">
  <div dir="ltr" class="gmail_attr" style="color: #64748b; font-size: 12px; margin-bottom: 6px;">
    On ${dateStr}, ${escapeHtml(senderStr)} wrote:<br>
  </div>
  <blockquote class="gmail_quote" style="margin: 0 0 0 0.8ex; border-left: 2px solid #cbd5e1; padding-left: 10px; color: #475569;">
    ${innerHtml}
  </blockquote>
</div>`.trim();
}

/**
 * Build Gmail-standard plaintext quote for replies ("> line" format)
 */
export function buildQuotedPlaintext(msg: QuotedMessage): string {
  const dateStr = formatQuoteDate(msg.date);
  const senderStr = formatSenderString(msg.fromName, msg.fromAddress);
  const rawText = msg.bodyText || "";

  const lines = rawText.split("\n");
  const quotedLines = lines.map((l) => `> ${l}`).join("\n");

  return `\n\nOn ${dateStr}, ${senderStr} wrote:\n${quotedLines}`;
}
