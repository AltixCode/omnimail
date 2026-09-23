"use client";

import React, { useMemo, useRef, useEffect, useState } from "react";
import DOMPurify from "isomorphic-dompurify";

interface MailRendererProps {
  rawHtml?: string | null;
  bodyText?: string | null;
  loadRemoteImages?: boolean;
}

export function MailRenderer({
  rawHtml,
  bodyText,
  loadRemoteImages = false,
}: MailRendererProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [iframeHeight, setIframeHeight] = useState<number>(400);

  const processedHtml = useMemo(() => {
    let source = rawHtml;

    if (!source || !source.trim()) {
      // Fallback to text formatted as HTML
      if (bodyText) {
        const escaped = bodyText
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/\n/g, "<br>");
        return `<div style="font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 14px; line-height: 1.6; color: #1e293b; white-space: pre-wrap;">${escaped}</div>`;
      }
      return `<p style="font-family: sans-serif; color: #94a3b8; font-style: italic;">(This message has no content)</p>`;
    }

    // Configure DOMPurify hooks
    DOMPurify.removeAllHooks();

    // Hook: handle image tags based on user privacy choice
    DOMPurify.addHook("uponSanitizeElement", (node, data) => {
      if (data.tagName === "img") {
        const el = node as HTMLImageElement;
        const src = el.getAttribute("src") || "";

        if (src.startsWith("http://") || src.startsWith("https://")) {
          if (!loadRemoteImages) {
            // Block remote image
            el.setAttribute(
              "src",
              "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='24' viewBox='0 0 100 24'%3E%3Crect width='100' height='24' fill='%23f1f5f9' rx='4'/%3E%3Ctext x='50' y='16' font-size='10' font-family='sans-serif' fill='%2394a3b8' text-anchor='middle'%3E[Image Blocked]%3C/text%3E%3C/svg%3E"
            );
            el.setAttribute("title", "Remote image blocked for privacy. Click 'Load Images' to view.");
            el.style.border = "1px dashed #cbd5e1";
            el.style.borderRadius = "4px";
            el.style.display = "inline-block";
          } else {
            // Route through secure proxy
            el.setAttribute("src", `/api/proxy/image?url=${encodeURIComponent(src)}`);
          }
        }
      }

      // Ensure all links open safely in a new tab
      if (data.tagName === "a") {
        const el = node as HTMLAnchorElement;
        el.setAttribute("target", "_blank");
        el.setAttribute("rel", "noopener noreferrer");
      }
    });

    const sanitized = DOMPurify.sanitize(source, {
      WHOLE_DOCUMENT: false,
      ADD_TAGS: ["style", "meta"],
      ADD_ATTR: ["target", "rel", "style", "class"],
      FORBID_TAGS: ["script", "iframe", "object", "embed", "form", "base"],
      FORBID_ATTR: ["onerror", "onload", "onclick", "onmouseover", "javascript:"],
    });

    // Clean inline styling wrapper for the iframe
    return `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <style>
            :root {
              color-scheme: light;
            }
            body {
              margin: 0;
              padding: 16px;
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
              font-size: 14px;
              line-height: 1.6;
              color: #1e293b;
              word-break: break-word;
              overflow-wrap: break-word;
              background-color: #ffffff;
            }
            img {
              max-width: 100% !important;
              height: auto !important;
            }
            table {
              max-width: 100% !important;
            }
            blockquote {
              border-left: 3px solid #cbd5e1;
              padding-left: 12px;
              margin-left: 0;
              color: #64748b;
            }
            a {
              color: #2563eb;
              text-decoration: underline;
            }
            pre, code {
              background-color: #f8fafc;
              border-radius: 4px;
              font-family: monospace;
              padding: 2px 4px;
              font-size: 13px;
            }
          </style>
        </head>
        <body>
          <div id="email-root">${sanitized}</div>
          <script>
            function reportHeight() {
              const height = document.documentElement.scrollHeight || document.body.scrollHeight;
              window.parent.postMessage({ type: 'resize-email-iframe', height }, '*');
            }
            window.addEventListener('load', reportHeight);
            setTimeout(reportHeight, 300);
            setTimeout(reportHeight, 1000);
          </script>
        </body>
      </html>
    `;
  }, [rawHtml, bodyText, loadRemoteImages]);

  // Adjust iframe height dynamically to prevent double scrollbars
  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      if (event.data && event.data.type === "resize-email-iframe") {
        if (typeof event.data.height === "number" && event.data.height > 100) {
          setIframeHeight(Math.max(300, event.data.height + 24));
        }
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  return (
    <div className="w-full relative overflow-hidden rounded-md border border-slate-200 bg-white">
      <iframe
        ref={iframeRef}
        srcDoc={processedHtml}
        sandbox="allow-popups allow-popups-to-escape-sandbox allow-scripts"
        className="w-full border-none transition-[height] duration-200"
        style={{ height: `${iframeHeight}px`, minHeight: "350px" }}
        title="Email Body"
      />
    </div>
  );
}

export default MailRenderer;
