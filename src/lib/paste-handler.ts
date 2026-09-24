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
 * Detects whether a string is likely to be Markdown formatting.
 */
export function isLikelyMarkdown(text: string): boolean {
  if (!text || text.length < 3) return false;
  const trimmed = text.trim();

  // Strong single-line markdown indicators
  if (/^#{1,6}\s+\S+/m.test(trimmed)) return true; // # Header
  if (/```[\s\S]*?```/.test(trimmed)) return true; // Code block
  if (/^\|[^\n]+\|\s*\n\|[-: ]+\|/m.test(trimmed)) return true; // Table
  if (/\[.+?\]\(https?:\/\/[^\s)]+\)/.test(trimmed)) return true; // [Link](url)

  let score = 0;

  // Multiple list items (at least 2 lines)
  const bullets = trimmed.match(/^[\t ]*[-*+]\s+\S+/gm);
  if (bullets && bullets.length >= 2) score += 2;

  // Multiple numbered list items (at least 2 lines)
  const numbers = trimmed.match(/^[\t ]*\d+\.\s+\S+/gm);
  if (numbers && numbers.length >= 2) score += 2;

  // Blockquotes
  if (/^>\s+\S+/m.test(trimmed)) score += 1;

  // Bold or strikethrough syntax
  if (/\*\*[^\s*][^*]*\*\*/.test(trimmed) || /__\S+__/.test(trimmed)) score += 1;
  if (/~~[^\s~][^~]*~~/.test(trimmed)) score += 1;

  // Inline code syntax
  if (/`[^`\n]+`/.test(trimmed)) score += 1;

  return score >= 2;
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

  // 1. If plainText is Markdown
  if (text && isLikelyMarkdown(text)) {
    try {
      const parsed = marked.parse(text) as string;
      const sanitized = DOMPurify.sanitize(parsed, {
        ADD_TAGS: ["table", "thead", "tbody", "tr", "th", "td", "u"],
      });
      return { processed: true, html: sanitized };
    } catch (e) {
      console.warn("Failed to parse markdown paste:", e);
    }
  }

  // 2. If plainText is raw HTML markup
  if (text && isLikelyRawHtml(text)) {
    try {
      const sanitized = DOMPurify.sanitize(text, {
        ADD_TAGS: ["table", "thead", "tbody", "tr", "th", "td", "u"],
      });
      return { processed: true, html: sanitized };
    } catch (e) {
      console.warn("Failed to parse raw HTML paste:", e);
    }
  }

  // 3. If clipboard provides rich text HTML
  if (html && html.trim().length > 0) {
    try {
      const sanitized = DOMPurify.sanitize(html, {
        ADD_TAGS: ["table", "thead", "tbody", "tr", "th", "td", "u"],
        ADD_ATTR: ["target", "rel", "href", "src", "style", "class"],
      });
      return { processed: true, html: sanitized };
    } catch (e) {
      console.warn("Failed to sanitize HTML paste:", e);
    }
  }

  return { processed: false, html: "" };
}
