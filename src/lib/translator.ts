/**
 * Email Translation Service via AI Proxy / OpenAI-compatible endpoint.
 * Preserves the exact HTML layout, inline styles, CSS, tables, fonts, and images,
 * and translates only the visible textual content into the target language.
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
export const DEFAULT_MODEL = "gemini-3-flash";

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

export function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#8202;/g, "\u200A");
}

export function escapeHtmlText(str: string): string {
  return str
    .replace(/&(?!amp;|lt;|gt;|quot;|#\d+;|#x[0-9a-fA-F]+;)/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Safely extracts human readable plain text from HTML.
 */
export function extractPlainTextFromHtml(html: string): string {
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
    // 2. Try repairing trailing commas or unquoted keys
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

      // Try array extraction for translations
      let translations: string[] = [];
      const transArrayMatch = cleaned.match(/"translations"\s*:\s*\[([\s\S]*?)\]/);
      if (transArrayMatch) {
        try {
          translations = JSON.parse(`[${transArrayMatch[1]}]`);
        } catch {
          // Fallback array regex
          const itemMatches = transArrayMatch[1].matchAll(/"((?:\\.|[^"\\])*)"/g);
          translations = Array.from(itemMatches, (m) => {
            try {
              return JSON.parse(`"${m[1]}"`);
            } catch {
              return m[1];
            }
          });
        }
      }

      return {
        subject: subjectMatch ? JSON.parse(`"${subjectMatch[1]}"`) : undefined,
        bodyHtml: null,
        bodyText: bodyTextMatch ? JSON.parse(`"${bodyTextMatch[1]}"`) : undefined,
        detectedLanguage: detectedLangMatch ? detectedLangMatch[1] : "Unknown",
        isAlreadyEnglish: isEnglishMatch ? isEnglishMatch[1].toLowerCase() === "true" : false,
        translations: translations.length > 0 ? translations : undefined,
      };
    }
  }
}

/**
 * Calls the AI proxy chat completion endpoint with robust error handling and decompression.
 */
async function callAiProxy(
  aiProxyUrl: string,
  aiProxyToken: string,
  model: string,
  messages: Array<{ role: string; content: string }>,
): Promise<any> {
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
      messages,
      temperature: 0.1,
    }),
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

  return parseLlmJson(rawAssistantContent);
}

/**
 * Main translation function.
 * Preserves the exact HTML layout, tables, styles, and images by extracting
 * text nodes and re-injecting translated strings into the exact same positions.
 */
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
    "";

  const model = input.aiModel || process.env.AI_PROXY_MODEL || DEFAULT_MODEL;

  const cacheKey = getCacheKey(input, targetLanguage, model);
  const cached = translationCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.result;
  }

  // -------------------------------------------------------------
  // Case A: Rich HTML Email -> Translate preserving EXACT layout
  // -------------------------------------------------------------
  if (rawHtml && rawHtml.trim()) {
    // Regex splits HTML into tags, styles, scripts, comments vs text nodes
    const TAG_AND_SPECIAL_REGEX = /(<!--[\s\S]*?-->|<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>|<noscript[\s\S]*?<\/noscript>|<svg[\s\S]*?<\/svg>|<[^>]+>)/gi;

    const parts: Array<{ type: "tag" | "text"; content: string }> = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = TAG_AND_SPECIAL_REGEX.exec(rawHtml)) !== null) {
      if (match.index > lastIndex) {
        parts.push({ type: "text", content: rawHtml.slice(lastIndex, match.index) });
      }
      parts.push({ type: "tag", content: match[0] });
      lastIndex = TAG_AND_SPECIAL_REGEX.lastIndex;
    }
    if (lastIndex < rawHtml.length) {
      parts.push({ type: "text", content: rawHtml.slice(lastIndex) });
    }

    interface TextNodeItem {
      partIndex: number;
      leading: string;
      trailing: string;
      text: string;
    }

    const textItems: TextNodeItem[] = [];
    parts.forEach((p, idx) => {
      if (p.type === "text") {
        const raw = p.content;
        const leading = (raw.match(/^\s*/) || [""])[0];
        const trailing = (raw.match(/\s*$/) || [""])[0];
        const core = raw.slice(leading.length, raw.length - trailing.length);
        if (!core) return;
        const unescaped = decodeHtmlEntities(core);
        // Translatable if contains any unicode letter
        if (/\p{L}/u.test(unescaped)) {
          textItems.push({ partIndex: idx, leading, trailing, text: unescaped });
        }
      }
    });

    const uniqueTexts = Array.from(new Set([
      ...(rawText && /\p{L}/u.test(rawText) ? [rawText] : []),
      ...textItems.map((t) => t.text),
    ]));

    // If HTML has no textual content, only translate the subject if present
    if (uniqueTexts.length === 0) {
      if (rawSubject) {
        const subRes = await callAiProxy(aiProxyUrl, aiProxyToken, model, [
          {
            role: "system",
            content: `Translate the email subject to ${targetLanguage}. Return ONLY JSON: {"subject": string, "detectedLanguage": string, "isAlreadyEnglish": boolean}`,
          },
          {
            role: "user",
            content: JSON.stringify({ subject: rawSubject }),
          },
        ]);
        const result: TranslationResult = {
          subject: subRes.subject || rawSubject,
          bodyHtml: rawHtml,
          bodyText: rawText,
          detectedLanguage: subRes.detectedLanguage || "Unknown",
          isAlreadyEnglish: Boolean(subRes.isAlreadyEnglish),
          model,
        };
        translationCache.set(cacheKey, { result, expiresAt: Date.now() + CACHE_TTL_MS });
        return result;
      }
      return {
        subject: "",
        bodyHtml: rawHtml,
        bodyText: rawText,
        detectedLanguage: "Unknown",
        isAlreadyEnglish: true,
        model,
      };
    }

    // Chunk unique texts into batches of up to 45 items to guarantee speed and reliability
    const BATCH_SIZE = 45;
    const batches: string[][] = [];
    for (let i = 0; i < uniqueTexts.length; i += BATCH_SIZE) {
      batches.push(uniqueTexts.slice(i, i + BATCH_SIZE));
    }

    // First batch includes subject, language detection, and isAlreadyEnglish check
    const batch1Promise = callAiProxy(aiProxyUrl, aiProxyToken, model, [
      {
        role: "system",
        content: `You are a professional email translation engine.
Translate the provided email subject and array of text snippets into ${targetLanguage}.
Guidelines:
1. Preserve all brand names, product codes, tracking numbers, dates, monetary amounts, and placeholders (such as asterisks ***) accurately.
2. Maintain natural phrasing, capitalization, and punctuation.
3. If the content is already in ${targetLanguage}, return it unchanged and set "isAlreadyEnglish": true.
4. Detect the source language (e.g. "Greek", "German", "French", "Spanish", "English") and set "detectedLanguage".
5. Return ONLY a valid JSON object matching this schema:
{
  "subject": "string",
  "detectedLanguage": "string",
  "isAlreadyEnglish": boolean,
  "translations": ["string"]
}
CRITICAL: The "translations" array MUST contain EXACTLY the same number of items (${batches[0].length}) in the EXACT same order as the input "texts" array.`,
      },
      {
        role: "user",
        content: JSON.stringify({
          subject: rawSubject,
          texts: batches[0],
        }),
      },
    ]);

    // Subsequent batches (if any) translate remaining text snippets
    const subsequentBatchPromises = batches.slice(1).map((batchTexts) =>
      callAiProxy(aiProxyUrl, aiProxyToken, model, [
        {
          role: "system",
          content: `You are a professional translation engine.
Translate the provided array of text snippets into ${targetLanguage}.
Guidelines:
1. Preserve all brand names, product codes, tracking numbers, dates, monetary amounts, and placeholders accurately.
2. Return ONLY a valid JSON object matching this schema:
{
  "translations": ["string"]
}
CRITICAL: The "translations" array MUST contain EXACTLY the same number of items (${batchTexts.length}) in the EXACT same order as the input "texts" array.`,
        },
        {
          role: "user",
          content: JSON.stringify({
            texts: batchTexts,
          }),
        },
      ]),
    );

    const [batch1Result, ...subsequentResults] = await Promise.all([
      batch1Promise,
      ...subsequentBatchPromises,
    ]);

    // If source content is already in target language, return untouched
    if (batch1Result.isAlreadyEnglish) {
      const result: TranslationResult = {
        subject: rawSubject,
        bodyHtml: rawHtml,
        bodyText: rawText,
        detectedLanguage: batch1Result.detectedLanguage || targetLanguage,
        isAlreadyEnglish: true,
        model,
      };
      translationCache.set(cacheKey, { result, expiresAt: Date.now() + CACHE_TTL_MS });
      return result;
    }

    // Combine translations from all batches
    const allTranslations: string[] = [...(batch1Result.translations || [])];
    for (const sub of subsequentResults) {
      if (Array.isArray(sub?.translations)) {
        allTranslations.push(...sub.translations);
      }
    }

    // Build translation lookup map
    const translationMap = new Map<string, string>();
    uniqueTexts.forEach((origText, idx) => {
      translationMap.set(origText, allTranslations[idx] || origText);
    });

    // Replace text in each text part while preserving exact leading/trailing whitespace & HTML formatting
    for (const item of textItems) {
      const translated = translationMap.get(item.text) || item.text;
      const escaped = escapeHtmlText(translated);
      parts[item.partIndex].content = item.leading + escaped + item.trailing;
    }

    const finalBodyHtml = parts.map((p) => p.content).join("");
    const finalBodyText = (rawText && translationMap.get(rawText)) || extractPlainTextFromHtml(finalBodyHtml);

    const result: TranslationResult = {
      subject: batch1Result.subject || rawSubject,
      bodyHtml: finalBodyHtml,
      bodyText: finalBodyText || rawText,
      detectedLanguage: batch1Result.detectedLanguage || "Unknown",
      isAlreadyEnglish: Boolean(batch1Result.isAlreadyEnglish),
      model,
    };

    if (translationCache.size >= MAX_CACHE_SIZE) {
      const oldestKey = translationCache.keys().next().value;
      if (oldestKey) translationCache.delete(oldestKey);
    }
    translationCache.set(cacheKey, { result, expiresAt: Date.now() + CACHE_TTL_MS });

    return result;
  }

  // -------------------------------------------------------------
  // Case B: Plain-text Email (No HTML)
  // -------------------------------------------------------------
  let textToTranslate = rawText || "";
  if (textToTranslate.length > 25000) {
    textToTranslate = textToTranslate.slice(0, 25000) + "\n\n... [Content truncated for translation]";
  }

  const systemPrompt = `You are an expert multilingual email translation engine.
Translate the provided email subject and text into ${targetLanguage}.
Guidelines:
1. Translate "bodyText" preserving natural paragraphs, bullet lists, and line breaks.
2. Translate "subject" accurately.
3. If already in ${targetLanguage}, return unchanged and set "isAlreadyEnglish": true.
4. Detect the source language and set "detectedLanguage".
5. Respond ONLY with a valid JSON object matching this schema:
{
  "subject": "string",
  "bodyText": "string",
  "detectedLanguage": "string",
  "isAlreadyEnglish": boolean
}`;

  const parsed = await callAiProxy(aiProxyUrl, aiProxyToken, model, [
    { role: "system", content: systemPrompt },
    {
      role: "user",
      content: JSON.stringify({
        subject: rawSubject,
        bodyText: textToTranslate,
      }),
    },
  ]);

  const result: TranslationResult = {
    subject: parsed.subject || rawSubject,
    bodyHtml: null,
    bodyText: parsed.bodyText || textToTranslate,
    detectedLanguage: parsed.detectedLanguage || "Unknown",
    isAlreadyEnglish: Boolean(parsed.isAlreadyEnglish),
    model,
  };

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
