import { marked } from "marked";
import DOMPurify from "isomorphic-dompurify";

/**
 * Configure marked with GitHub Flavored Markdown (tables, autolinks, strikethrough, task lists)
 */
marked.setOptions({
  gfm: true,
  breaks: true,
});

/**
 * Normalizes plain text before parsing:
 * - Strips duplicate list markers at line starts (e.g. "• - ", "- - ", "1. 1. ", "1. - ")
 * - Converts unicode bullets (•, ·, –, —) at line starts to standard markdown dashes (- )
 * - Converts "1) " to "1. "
 */
export function normalizeTextForMarkdown(text: string): string {
  if (!text) return "";
  return text
    // Strip duplicate bullet/dash markers like "• - ", "- - ", "- • " at line starts
    .replace(/^([\t ]*)[•·–—\-*+][\t ]+[•·–—\-*+][\t ]+/gm, "$1- ")
    // Strip duplicate number or number+dash markers like "1. 1. " or "1. - " at line starts
    .replace(/^([\t ]*\d+)[\.\)][\t ]+(?:\d+[\.\)]|[-*+•·–—])[\t ]+/gm, "$1. ")
    // Replace unicode bullets and dashes at beginning of line with markdown dash
    .replace(/^([\t ]*)[•·–—][\t ]+/gm, "$1- ")
    // Replace numbered lists like "1) " with "1. "
    .replace(/^([\t ]*\d+)\)[\t ]+/gm, "$1. ");
}

/**
 * Strips redundant literal list markers from HTML list items (<li>).
 * When text with literal numbers (e.g. "1. ") or dashes (e.g. "- ") is put inside
 * <ol><li> or <ul><li>, browsers render both the CSS list marker (bullet or number)
 * AND the literal text, producing unsightly duplicates like "1. 1. ", "1. - ", or "• - ".
 */
export function cleanRedundantListMarkers(html: string): string {
  if (!html) return "";

  // 1. Clean <ul> items: remove leading bullet/dash/number marker from <li> or first child <p>/<span>/<div>
  let cleaned = html.replace(
    /(<ul\b[^>]*>[\s\S]*?<\/ul>)/gi,
    (ulBlock) => {
      return ulBlock.replace(
        /(<li\b[^>]*>(?:\s*<(?:p|span|div)\b[^>]*>)*)([\s\u00a0]*(?:[-*+•·–—]|\d+[\.\)])[\s\u00a0]*)+/gi,
        (match, prefix) => prefix
      );
    }
  );

  // 2. Clean <ol> items: remove leading number (1., 1), etc.) or dash/bullet from <li> or first child
  cleaned = cleaned.replace(
    /(<ol\b[^>]*>[\s\S]*?<\/ol>)/gi,
    (olBlock) => {
      return olBlock.replace(
        /(<li\b[^>]*>(?:\s*<(?:p|span|div)\b[^>]*>)*)([\s\u00a0]*(?:\d+[\.\)]|[-*+•·–—])[\s\u00a0]*)+/gi,
        (match, prefix) => prefix
      );
    }
  );

  return cleaned;
}

/**
 * Detects whether a string is likely to be Markdown formatting or structured list text.
 */
export function isLikelyMarkdown(text: string): boolean {
  if (!text || text.length < 2) return false;
  const trimmed = text.trim();

  // Strong markdown indicators
  if (/^#{1,6}\s+\S+/m.test(trimmed)) return true; // # Header
  if (/```[\s\S]*?```/.test(trimmed)) return true; // Code block
  if (/^\|[^\n]+\|\s*\n\|[-: ]+\|/m.test(trimmed)) return true; // Table
  if (/\[.+?\]\(https?:\/\/[^\s)]+\)/.test(trimmed)) return true; // [Link](url)
  if (/^[\t ]*[-*+]\s+\S+/m.test(trimmed)) return true; // Bullet list item (even single item)
  if (/^[\t ]*[•·–—]\s+\S+/m.test(trimmed)) return true; // Unicode bullet item
  if (/^[\t ]*\d+[\.\)]\s+\S+/m.test(trimmed)) return true; // Numbered list item (e.g. "1. " or "1) ")
  if (/^>\s+\S+/m.test(trimmed)) return true; // Blockquote
  if (/\*\*[^\s*][^*]*\*\*/.test(trimmed) || /__\S+__/.test(trimmed)) return true; // Bold
  if (/~~[^\s~][^~]*~~/.test(trimmed)) return true; // Strikethrough
  if (/`[^`\n]+`/.test(trimmed)) return true; // Inline code

  return false;
}

/**
 * Detects whether a string is likely to be raw HTML markup pasted as plain text.
 */
export function isLikelyRawHtml(text: string): boolean {
  if (!text || text.length < 5) return false;
  const trimmed = text.trim();
  if (!trimmed.startsWith("<") || !trimmed.endsWith(">")) return false;

  const hasOpeningClosing = /<([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>[\s\S]*?<\/\1>/i.test(trimmed);
  const hasBlockTags = /<(?:p|div|h[1-6]|ul|ol|li|table|thead|tbody|tr|td|th|blockquote|pre|section|article)\b[^>]*>/i.test(trimmed);

  return hasOpeningClosing || hasBlockTags;
}

/**
 * Converts Markdown or HTML string into sanitized, TipTap-compatible HTML.
 */
export function processPastedContent(options: {
  html?: string | null;
  text?: string | null;
}): { processed: boolean; html: string } {
  const { html, text } = options;

  // Helper to sanitize and clean list markers
  const cleanAndSanitize = (raw: string): string => {
    const sanitized = DOMPurify.sanitize(raw, {
      ADD_TAGS: ["table", "thead", "tbody", "tr", "th", "td", "u", "ol", "ul", "li", "p", "br", "hr"],
      ADD_ATTR: ["target", "rel", "href", "src", "style", "class"],
    });
    return cleanRedundantListMarkers(sanitized);
  };

  // 1. If plainText is Markdown or contains list markers (bullets, numbered lists, etc.)
  if (text && isLikelyMarkdown(text)) {
    try {
      const normalized = normalizeTextForMarkdown(text);
      const parsed = marked.parse(normalized) as string;
      return { processed: true, html: cleanAndSanitize(parsed) };
    } catch (e) {
      console.warn("Failed to parse markdown paste:", e);
    }
  }

  // 2. If plainText is raw HTML markup
  if (text && isLikelyRawHtml(text)) {
    try {
      return { processed: true, html: cleanAndSanitize(text) };
    } catch (e) {
      console.warn("Failed to parse raw HTML paste:", e);
    }
  }

  // 3. If clipboard provides rich text HTML (e.g. from Google Docs, Apple Notes, browser)
  if (html && html.trim().length > 0) {
    try {
      return { processed: true, html: cleanAndSanitize(html) };
    } catch (e) {
      console.warn("Failed to sanitize HTML paste:", e);
    }
  }

  // 4. If plainText contains multiple lines or paragraph breaks (\n\n or \n), convert to paragraphs & breaks
  if (text && text.includes("\n")) {
    try {
      const normalized = normalizeTextForMarkdown(text);
      const parsed = marked.parse(normalized) as string;
      return { processed: true, html: cleanAndSanitize(parsed) };
    } catch (e) {
      console.warn("Failed to parse multiline text paste:", e);
    }
  }

  return { processed: false, html: "" };
}
