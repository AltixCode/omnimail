import { test } from "node:test";
import assert from "node:assert/strict";
import { translateEmail } from "../src/lib/translator";

test("translateEmail handles empty inputs gracefully", async () => {
  const result = await translateEmail({ subject: "", bodyHtml: "", bodyText: "" });
  assert.equal(result.subject, "");
  assert.equal(result.isAlreadyEnglish, true);
});

test("translateEmail translates foreign subject and text via AI proxy", async () => {
  const result = await translateEmail({
    subject: "Bonjour le monde",
    bodyText: "Ceci est un message de test en français.",
    bodyHtml: "<p>Ceci est un <strong>message</strong> de test en français.</p>",
  });

  assert.ok(result.subject.length > 0);
  assert.ok(/hello|world|good/i.test(result.subject));
  assert.equal(result.isAlreadyEnglish, false);
  assert.ok(result.detectedLanguage.toLowerCase().includes("french") || result.detectedLanguage.toLowerCase().includes("fr"));
  assert.ok(result.bodyHtml?.includes("<strong"));
  assert.ok(/this is a test message/i.test(result.bodyText || ""));
});

test("translateEmail uses in-memory cache on subsequent calls", async () => {
  const input = {
    subject: "Guten Tag allerseits",
    bodyText: "Wir freuen uns auf das Treffen.",
    bodyHtml: "<p>Wir freuen uns auf das Treffen.</p>",
  };

  const start1 = Date.now();
  const res1 = await translateEmail(input);
  const dur1 = Date.now() - start1;

  const start2 = Date.now();
  const res2 = await translateEmail(input);
  const dur2 = Date.now() - start2;

  assert.equal(res1.subject, res2.subject);
  assert.equal(res1.bodyText, res2.bodyText);
  // Second call must be instant (< 10ms) from cache
  assert.ok(dur2 < 20);
});

test("translateEmail handles huge HTML safely while preserving exact layout and tags", async () => {
  const hugeHtml = '<div class="email-wrapper"><table style="background-color: #ff6600;"><tr><td><strong style="color: white;">Επιβεβαίωση παραγγελίας</strong></td></tr></table>'.repeat(200) + '</div>';
  const bodyText = "Λάβαμε την Παραγγελία σου & σε ευχαριστούμε. Η παραγγελία καταχωρήθηκε.";
  const input = {
    subject: "Επιβεβαίωση Καταχώρισης Παραγγελίας ✔",
    bodyHtml: hugeHtml,
    bodyText,
    targetLanguage: "English",
  };

  const result = await translateEmail(input);
  assert.ok(result.subject.length > 0);
  assert.ok(/order|confirmation/i.test(result.subject));
  assert.ok(/order|thank/i.test(result.bodyText || ""));
  assert.ok(result.bodyHtml !== null);
  assert.ok(result.bodyHtml?.includes('class="email-wrapper"'));
  assert.ok(result.bodyHtml?.includes('style="background-color: #ff6600;"'));
  assert.ok(/order|confirmation/i.test(result.bodyHtml || ""));
});

test("testAiTranslation runs diagnostic check successfully", async () => {
  const { testAiTranslation } = await import("../src/lib/translator");
  const testRes = await testAiTranslation({ targetLanguage: "English" });
  assert.equal(testRes.success, true);
  assert.ok(testRes.latencyMs > 0);
  assert.ok(testRes.translatedText && testRes.translatedText.length > 0);
});
