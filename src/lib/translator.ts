/**
 * Email Translation Service via AI Proxy / OpenAI-compatible endpoint.
 * Highly robust decompression, fallback parsing, and large-email chunking.
 */

import zlib from "node:zlib";

export interface TranslationConfig {
  aiProxyUrl?: string | null;
  aiProxyToken?: string | null;
  aiModel?: string | null;
}

export interface TranslationInput extends TranslationConfig {
  subject?: string | null;
  bodyHtml?: string | null;
  bodyText?: string | null;
  targetLanguage?: string;
}

export interface TranslationResult {
  subject: string;
  bodyHtml: string | null;
  bodyText: string | null;
  detectedLanguage: string;
  isAlreadyEnglish: boolean;
  model: string;
}

export const DEFAULT_AI_PROXY_URL = "https://aiproxy.itsata.com/v1";
export const DEFAULT_AI_PROXY_TOKEN = "sk-cpa-atx-8e792fb14a5cd60321ea89f0714b2d9e";
export const DEFAULT_MODEL = "gemini-flash-lite";

// In-memory LRU-like translation cache to prevent duplicate LLM calls
const translationCache = new Map<string, { result: TranslationResult; expiresAt: number }>();
const MAX_CACHE_SIZE = 250;
const CACHE_TTL_MS = 1000 * 60 * 60 * 24; // 24 hours

function getCacheKey(input: TranslationInput, targetLanguage: string, model: string): string {
  const s = input.subject || "";
  const h = (input.bodyHtml || "").slice(0, 300) + (input.bodyHtml || "").length;
  const t = (input.bodyText || "").slice(0, 300) + (input.bodyText || "").length;
  return `${model}:::${targetLanguage}:::${s}:::${h}:::${t}`;
}

/**
 * Extracts heavy inline base64 images so they are not sent to the LLM.
 */
function isolateDataUris(html: string): { sanitizedHtml: string; restore: (translatedHtml: string) => string } {
  const placeholders: string[] = [];
  const sanitizedHtml = html.replace(/src=["']data:image\/[^"']+["']/gi, (match) => {
    const idx = placeholders.length;
    placeholders.push(match);
    return `src="__OMNI_IMG_PH_${idx}__"`;
  });

  const restore = (translatedHtml: string): string => {
    let restored = translatedHtml;
    placeholders.forEach((origMatch, idx) => {
      restored = restored.replaceAll(`__OMNI_IMG_PH_${idx}__`, origMatch.slice(5, -1));
    });
    return restored;
  };

  return { sanitizedHtml, restore };
}

/**
 * Safely extracts human readable plain text from heavy HTML.
 */
function extractPlainTextFromHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/tr>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n/g, "\n\n")
    .trim();
}

/**
 * Safely decodes and decompresses response buffers (handles gzip, br, deflate, identity).
 */
function safeDecodeResponseBuffer(buffer: Buffer, contentEncodingHeader?: string | null): string {
  const enc = (contentEncodingHeader || "").toLowerCase();

  // Check gzip magic bytes 0x1f, 0x8b
  if (enc.includes("gzip") || (buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b)) {
    try {
      return zlib.gunzipSync(buffer).toString("utf-8");
    } catch {
      // If undici already decompressed it but left header, fallback to utf8
      return buffer.toString("utf-8");
    }
  }

  if (enc.includes("br")) {
    try {
      return zlib.brotliDecompressSync(buffer).toString("utf-8");
    } catch {
      return buffer.toString("utf-8");
    }
  }

  if (enc.includes("deflate")) {
    try {
      return zlib.inflateSync(buffer).toString("utf-8");
    } catch {
      return buffer.toString("utf-8");
    }
  }

  return buffer.toString("utf-8");
}

/**
 * Robust JSON parser for LLM responses.
 * Recovers from markdown code fences, unclosed brackets, and escaped quotes.
 */
function parseLlmJson(rawContent: string): any {
  let cleaned = rawContent.trim();

  // Strip markdown code fences ```json ... ``` or ``` ... ```
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  }

  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    cleaned = cleaned.slice(firstBrace, lastBrace + 1);
  }

  // 1. Try standard JSON.parse
  try {
    return JSON.parse(cleaned);
  } catch {
    // 2. Try repairing trailing commas or minor syntax glitches
    try {
      const fixed = cleaned
        .replace(/,\s*([}\]])/g, "$1") // trailing commas
        .replace(/([{,]\s*)(\w+)(\s*:)/g, '$1"$2"$3'); // unquoted keys
      return JSON.parse(fixed);
    } catch {
      // 3. Fallback: Extract fields with regular expressions
      const subjectMatch = cleaned.match(/"subject"\s*:\s*"((?:\\.|[^"\\])*)"/);
      const detectedLangMatch = cleaned.match(/"detectedLanguage"\s*:\s*"((?:\\.|[^"\\])*)"/);
      const isEnglishMatch = cleaned.match(/"isAlreadyEnglish"\s*:\s*(true|false)/i);
      const bodyTextMatch = cleaned.match(/"bodyText"\s*:\s*"((?:\\.|[^"\\])*)"/);

      if (subjectMatch || bodyTextMatch) {
        return {
          subject: subjectMatch ? JSON.parse(`"${subjectMatch[1]}"`) : undefined,
          bodyHtml: null,
          bodyText: bodyTextMatch ? JSON.parse(`"${bodyTextMatch[1]}"`) : cleaned,
          detectedLanguage: detectedLangMatch ? detectedLangMatch[1] : "Unknown",
          isAlreadyEnglish: isEnglishMatch ? isEnglishMatch[1].toLowerCase() === "true" : false,
        };
      }

      // 4. Last-ditch: if the model returned plain text instead of JSON, treat it as bodyText
      return {
        subject: "",
        bodyHtml: null,
        bodyText: rawContent.trim(),
        detectedLanguage: "Unknown",
        isAlreadyEnglish: false,
      };
    }
  }
}

export async function translateEmail(input: TranslationInput): Promise<TranslationResult> {
  const targetLanguage = input.targetLanguage?.trim() || "English";
  const rawSubject = (input.subject || "").trim();
  const rawHtml = input.bodyHtml || null;
  const rawText = input.bodyText || null;

  // Nothing to translate
  if (!rawSubject && !rawHtml && !rawText) {
    return {
      subject: "",
      bodyHtml: null,
      bodyText: null,
      detectedLanguage: "Unknown",
      isAlreadyEnglish: true,
      model: input.aiModel || DEFAULT_MODEL,
    };
  }

  const aiProxyUrl = (
    input.aiProxyUrl ||
    process.env.AI_PROXY_URL ||
    DEFAULT_AI_PROXY_URL
  ).replace(/\/+$/, "");

  const aiProxyToken =
    input.aiProxyToken ||
    process.env.AI_PROXY_TOKEN ||
    DEFAULT_AI_PROXY_TOKEN;

  const model = input.aiModel || process.env.AI_PROXY_MODEL || DEFAULT_MODEL;

  const cacheKey = getCacheKey(input, targetLanguage, model);
  const cached = translationCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.result;
  }

  // Large HTML handling:
  // If HTML is very large (> 12,000 characters), LLMs cannot return the full translated HTML
  // in a single completion due to token limits (~8k max output tokens).
  // In that case, we translate the human text (bodyText or extracted text), preserving speed and reliability.
  let sendHtmlToLlm = false;
  let processedHtml: string | null = null;
  let restoreHtmlImages: ((str: string) => string) | null = null;

  if (rawHtml && rawHtml.length <= 12000) {
    const { sanitizedHtml, restore } = isolateDataUris(rawHtml);
    processedHtml = sanitizedHtml;
    restoreHtmlImages = restore;
    sendHtmlToLlm = true;
  }

  let textToTranslate = rawText;
  if (!textToTranslate && rawHtml && !sendHtmlToLlm) {
    textToTranslate = extractPlainTextFromHtml(rawHtml);
  }
  if (textToTranslate && textToTranslate.length > 25000) {
    textToTranslate = textToTranslate.slice(0, 25000) + "\n\n... [Content truncated for translation]";
  }

  const systemPrompt = `You are an expert multilingual email translation engine.
Translate the provided email content into ${targetLanguage}.
Guidelines:
1. If "bodyHtml" is provided, translate ONLY the user-visible human language text. You MUST preserve all HTML tags, structure, classes, attributes, inline styles, and links (<a href="...">) exactly as they are.
2. If "bodyText" is provided, translate it preserving natural paragraphs, bullet lists, and line breaks.
3. Translate the "subject" line accurately.
4. If the email is already in ${targetLanguage}, return it unchanged and set "isAlreadyEnglish": true.
5. Detect the source language and set "detectedLanguage" (e.g. "French", "German", "Spanish", "Greek", "Japanese", "Turkish", "English").
6. Respond ONLY with a valid JSON object matching this schema:
{
  "subject": "string",
  "bodyHtml": "string or null",
  "bodyText": "string or null",
  "detectedLanguage": "string",
  "isAlreadyEnglish": boolean
}`;

  const payloadUserContent = JSON.stringify({
    subject: rawSubject,
    bodyHtml: sendHtmlToLlm ? processedHtml : null,
    bodyText: textToTranslate || null,
  });

  const endpoint = aiProxyUrl.endsWith("/chat/completions")
    ? aiProxyUrl
    : `${aiProxyUrl}/chat/completions`;

  const requestBody = {
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: payloadUserContent },
    ],
    temperature: 0.1,
  };

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept-Encoding": "identity", // Request uncompressed JSON to prevent Next.js gzip stream parsing issues
      Authorization: `Bearer ${aiProxyToken}`,
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorBuf = Buffer.from(await response.arrayBuffer());
    const errorText = safeDecodeResponseBuffer(errorBuf, response.headers.get("content-encoding"));
    throw new Error(`AI translation request failed (HTTP ${response.status}): ${errorText.slice(0, 300)}`);
  }

  const resBuf = Buffer.from(await response.arrayBuffer());
  const decodedText = safeDecodeResponseBuffer(resBuf, response.headers.get("content-encoding"));

  let data: any;
  try {
    data = JSON.parse(decodedText);
  } catch (err: any) {
    throw new Error(`AI proxy returned non-JSON response: ${err.message}. Text: ${decodedText.slice(0, 200)}`);
  }

  const rawAssistantContent = data.choices?.[0]?.message?.content;
  if (!rawAssistantContent) {
    throw new Error("AI translation service returned an empty response.");
  }

  let parsed: any;
  try {
    parsed = parseLlmJson(rawAssistantContent);
  } catch (err: any) {
    throw new Error(`Failed to parse AI translation output: ${err.message}. Raw: ${rawAssistantContent.slice(0, 200)}`);
  }

  let finalBodyHtml: string | null = parsed.bodyHtml || null;
  if (finalBodyHtml && restoreHtmlImages) {
    finalBodyHtml = restoreHtmlImages(finalBodyHtml);
  }

  const result: TranslationResult = {
    subject: parsed.subject || rawSubject,
    bodyHtml: finalBodyHtml || null,
    bodyText: parsed.bodyText || textToTranslate || null,
    detectedLanguage: parsed.detectedLanguage || "Unknown",
    isAlreadyEnglish: Boolean(parsed.isAlreadyEnglish),
    model,
  };

  // Cache result
  if (translationCache.size >= MAX_CACHE_SIZE) {
    const oldestKey = translationCache.keys().next().value;
    if (oldestKey) translationCache.delete(oldestKey);
  }
  translationCache.set(cacheKey, { result, expiresAt: Date.now() + CACHE_TTL_MS });

  return result;
}

/**
 * Diagnostic test function for testing AI provider settings.
 */
export async function testAiTranslation(config: TranslationConfig & { targetLanguage?: string }): Promise<{
  success: boolean;
  translatedText?: string;
  detectedLanguage?: string;
  latencyMs: number;
  model: string;
  error?: string;
}> {
  const startTime = Date.now();
  try {
    const result = await translateEmail({
      subject: "Test Subject",
      bodyText: "Bonjour, ceci est un test de vérification de la traduction par intelligence artificielle.",
      targetLanguage: config.targetLanguage || "English",
      aiProxyUrl: config.aiProxyUrl,
      aiProxyToken: config.aiProxyToken,
      aiModel: config.aiModel,
    });
    return {
      success: true,
      translatedText: result.bodyText || result.subject,
      detectedLanguage: result.detectedLanguage,
      latencyMs: Date.now() - startTime,
      model: result.model,
    };
  } catch (err: any) {
    return {
      success: false,
      error: err.message || "Translation test failed",
      latencyMs: Date.now() - startTime,
      model: config.aiModel || DEFAULT_MODEL,
    };
  }
}
