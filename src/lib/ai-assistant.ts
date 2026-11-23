/**
 * AI Assistant for OmniMail (Web & Mobile)
 * Provides context-aware email drafting ("Help me write") and professional rephrasing
 * using the Altix AI Proxy (gemini-4-hydrogen-medium / OpenAI-compatible endpoint).
 */

import {
  DEFAULT_AI_PROXY_URL,
  DEFAULT_AI_PROXY_TOKEN,
  extractPlainTextFromHtml,
} from "./translator";

export const DEFAULT_AI_ASSIST_MODEL = "gemini-4-hydrogen-medium";

export interface ThreadMessageContext {
  id?: string;
  from?: string | null;
  to?: string | null;
  date?: string | Date | null;
  subject?: string | null;
  body?: string | null;
}

export interface AiAssistOptions {
  action: "rephrase" | "draft";
  text?: string | null; // Current draft or basic text
  instruction?: string | null; // What the user wants to draft or change
  tone?: "professional" | "casual" | "concise" | "formal" | string | null;
  threadMessages?: ThreadMessageContext[];
  subject?: string | null;
  recipient?: string | null;
  sender?: string | null;
  aiProxyUrl?: string | null;
  aiProxyToken?: string | null;
  aiModel?: string | null;
}

export interface AiAssistResult {
  text: string;
  action: "rephrase" | "draft";
  model: string;
}

function cleanMessageBody(body?: string | null): string {
  if (!body) return "";
  const trimmed = body.trim();
  if (trimmed.startsWith("<") && trimmed.endsWith(">")) {
    return extractPlainTextFromHtml(trimmed);
  }
  // If it contains HTML tags, strip them for a cleaner prompt
  if (/<[a-z][\s\S]*>/i.test(trimmed)) {
    return extractPlainTextFromHtml(trimmed);
  }
  return trimmed;
}

export function formatThreadContext(
  messages?: ThreadMessageContext[],
  maxCharsPerMessage = 3000,
): string {
  if (!messages || messages.length === 0) return "";

  const formatted = messages.map((m, index) => {
    const fromStr = m.from || "Unknown Sender";
    const toStr = m.to ? `To: ${m.to}\n` : "";
    const dateStr = m.date ? `Date: ${new Date(m.date).toLocaleString()}\n` : "";
    const subjectStr = m.subject ? `Subject: ${m.subject}\n` : "";
    const bodyStr = cleanMessageBody(m.body).slice(0, maxCharsPerMessage);

    return `--- Message ${index + 1} ---
From: ${fromStr}
${toStr}${dateStr}${subjectStr}Content:
${bodyStr}
--- End of Message ${index + 1} ---`;
  });

  return formatted.join("\n\n");
}

/**
 * Executes an AI assist request (draft or rephrase) with full thread context.
 */
export async function executeAiAssist(options: AiAssistOptions): Promise<AiAssistResult> {
  const {
    action,
    text = "",
    instruction = "",
    tone = "professional",
    threadMessages = [],
    subject,
    recipient,
    sender,
  } = options;

  const aiProxyUrl = (
    options.aiProxyUrl ||
    process.env.AI_PROXY_URL ||
    DEFAULT_AI_PROXY_URL
  ).replace(/\/+$/, "");

  const aiProxyToken =
    options.aiProxyToken ||
    process.env.AI_PROXY_TOKEN ||
    DEFAULT_AI_PROXY_TOKEN;

  const model =
    options.aiModel ||
    process.env.AI_PROXY_MODEL ||
    DEFAULT_AI_ASSIST_MODEL;

  const threadContextText = formatThreadContext(threadMessages);

  const systemPrompt = `You are an expert executive email assistant built into OmniMail (like Gmail's 'Help me write').
Your job is to draft or rephrase an email based on the user's request, any existing draft, and the preceding email thread context.

CRITICAL INSTRUCTIONS:
1. Output ONLY the drafted or rephrased email text ready to be inserted directly into the email body.
2. Do NOT include any conversational preamble (e.g., 'Here is your email:', 'Sure!', 'Option 1:').
3. Do NOT include quotes or markdown blockquotes ('>') around the entire email.
4. Output clean, well-spaced paragraphs with standard blank lines between them.
5. If drafting a reply, align seamlessly with the thread: use the recipient's name if known, address points asked in previous messages, and match the specified tone (${tone}).
6. Maintain any critical factual details, dates, numbers, links, or specific requirements mentioned by the user.`;

  let userPrompt = "";

  if (threadContextText) {
    userPrompt += `EMAIL THREAD CONTEXT (Chronological order):\n${threadContextText}\n\n`;
  }

  if (subject) {
    userPrompt += `Email Subject: ${subject}\n`;
  }
  if (recipient) {
    userPrompt += `Recipient: ${recipient}\n`;
  }
  if (sender) {
    userPrompt += `Sender (Me): ${sender}\n`;
  }
  userPrompt += `Tone: ${tone}\n\n`;

  if (action === "rephrase") {
    userPrompt += `USER'S BASIC DRAFT TO REPHRASE:\n"""\n${(text || "").trim()}\n"""\n\n`;
    if (instruction && instruction.trim()) {
      userPrompt += `SPECIFIC REVISION INSTRUCTION: ${instruction.trim()}\n\n`;
    }
    userPrompt += `TASK: Rephrase the draft above into a polished, professional email that fits naturally into the thread context. Output ONLY the refined email text.`;
  } else {
    // action === "draft"
    if (text && text.trim()) {
      userPrompt += `CURRENT DRAFT CONTENT (if any):\n"""\n${text.trim()}\n"""\n\n`;
    }
    userPrompt += `USER INSTRUCTION FOR THIS EMAIL:\n"""\n${(instruction || "Draft a helpful, professional reply based on the thread context.").trim()}\n"""\n\n`;
    userPrompt += `TASK: Draft a complete, high-quality email fulfilling the user's instruction and addressing the thread context. Output ONLY the final email text.`;
  }

  const endpoint = aiProxyUrl.endsWith("/chat/completions")
    ? aiProxyUrl
    : `${aiProxyUrl}/chat/completions`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept-Encoding": "identity",
      Authorization: `Bearer ${aiProxyToken}`,
      "User-Agent": "OmniMail/1.0",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.3,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(
      `AI service request failed (HTTP ${response.status}): ${errorText.slice(0, 300)}`
    );
  }

  const data = await response.json();
  const rawContent = data.choices?.[0]?.message?.content;

  if (!rawContent || typeof rawContent !== "string") {
    throw new Error("AI service returned an empty response.");
  }

  // Strip accidental markdown fences if returned
  let cleaned = rawContent.trim();
  if (cleaned.startsWith("```") && cleaned.endsWith("```")) {
    cleaned = cleaned.replace(/^```[a-z]*\s*/i, "").replace(/\s*```$/, "").trim();
  }

  return {
    text: cleaned,
    action,
    model,
  };
}
