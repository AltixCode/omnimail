import test from "node:test";
import assert from "node:assert/strict";
import { processPastedContent, isLikelyMarkdown, normalizeTextForMarkdown, cleanRedundantListMarkers } from "../src/lib/paste-handler";

test("paste-handler: correctly identifies markdown and structured list items", () => {
  assert.equal(isLikelyMarkdown("- single bullet item"), true);
  assert.equal(isLikelyMarkdown("• unicode bullet item"), true);
  assert.equal(isLikelyMarkdown("1. numbered item"), true);
  assert.equal(isLikelyMarkdown("1) alternative numbered item"), true);
  assert.equal(isLikelyMarkdown("# Heading"), true);
  assert.equal(isLikelyMarkdown("> A blockquote"), true);
  assert.equal(isLikelyMarkdown("**bold text**"), true);
});

test("paste-handler: normalizes unicode bullets and parentheses lists", () => {
  const input = "• item one\n• item two\n1) step one\n2) step two";
  const normalized = normalizeTextForMarkdown(input);
  assert.match(normalized, /^- item one/m);
  assert.match(normalized, /^- item two/m);
  assert.match(normalized, /^1\. step one/m);
  assert.match(normalized, /^2\. step two/m);
});

test("paste-handler: formats user dividend email with paragraphs, bullet lists, and numbered lists", () => {
  const emailText = `Dear Maria,

I hope this email finds you well.

I am writing to inquire about declaring and distributing an interim dividend for Altix Code Ltd.

I would like to consider an initial dividend distribution of €4,000.00. For your context regarding company liquidity and cash flow:
- The current company bank account balance stands at €8,673.66.
- I anticipate an incoming client payment of approximately €6,200.00 by the end of November 2026.

In case it is relevant for withholding tax purposes, please note that Michaela has submitted my application for Cyprus Non-Domicile (non-dom) tax status, though I have not received the confirmation or certificate back yet.

Could you please review this request against the company's cumulative realized net profits and advise on the appropriate figures? If necessary, please feel free to adjust the proposed distribution amount to ensure sufficient reserves are maintained for corporation tax, VAT, and ongoing working capital.

Additionally, kindly let me know:
1. The formal corporate procedure and documentation required from my side (such as interim management accounts or a board resolution declaring the dividend).
2. The applicable withholding obligations, if any, given the pending non-dom certificate (e.g., GeSY contributions or filing requirements).
3. Once confirmed, when and how much I may formally transfer from the company bank account to my personal account.

Thank you in advance for your guidance and assistance.

Best regards,

Mirata Seddigh Mohammadi
Director, Altix Code Ltd`;

  const result = processPastedContent({ text: emailText });
  assert.equal(result.processed, true);

  // Check paragraphs
  assert.match(result.html, /<p>Dear Maria,<\/p>/);
  assert.match(result.html, /<p>I hope this email finds you well.<\/p>/);

  // Check bullet list
  assert.match(result.html, /<ul>[\s\S]*?<li>The current company bank account balance stands at €8,673\.66\.<\/li>/);
  assert.match(result.html, /<li>I anticipate an incoming client payment of approximately €6,200\.00 by the end of November 2026\.<\/li>[\s\S]*?<\/ul>/);

  // Check numbered list
  assert.match(result.html, /<ol>[\s\S]*?<li>The formal corporate procedure and documentation required from my side/);
  assert.match(result.html, /<li>The applicable withholding obligations, if any/);
  assert.match(result.html, /<li>Once confirmed, when and how much I may formally transfer[\s\S]*?<\/ol>/);

  // Check signature with break
  assert.match(result.html, /Mirata Seddigh Mohammadi<br>Director, Altix Code Ltd/);
});

test("paste-handler: converts multiline plain text with double newlines into separate paragraphs", () => {
  const plainText = "Paragraph 1\n\nParagraph 2\n\nParagraph 3";
  const result = processPastedContent({ text: plainText });
  assert.equal(result.processed, true);
  assert.match(result.html, /<p>Paragraph 1<\/p>/);
  assert.match(result.html, /<p>Paragraph 2<\/p>/);
  assert.match(result.html, /<p>Paragraph 3<\/p>/);
});

test("paste-handler: cleans and sanitizes rich HTML input while preserving lists and tables", () => {
  const richHtml = `
    <div>
      <p style="color: red;">Hello world</p>
      <ul>
        <li>Bullet A</li>
        <li>Bullet B</li>
      </ul>
      <ol>
        <li>Number 1</li>
        <li>Number 2</li>
      </ol>
      <script>alert('xss')</script>
    </div>
  `;

  const result = processPastedContent({ html: richHtml });
  assert.equal(result.processed, true);
  assert.match(result.html, /<ul>[\s\S]*?<li>Bullet A<\/li>[\s\S]*?<\/ul>/);
  assert.match(result.html, /<ol>[\s\S]*?<li>Number 1<\/li>[\s\S]*?<\/ol>/);
  assert.ok(!result.html.includes("<script>"));
});

test("cleanRedundantListMarkers: strips redundant markers from ul and ol list items", () => {
  // Scenario from user screenshots:
  // 1. <ul> items starting with "- " or "• - "
  const ulHtml = `<ul>
    <li><p>- The current company bank account balance stands at €8,673.66.</p></li>
    <li><p>- I anticipate an incoming client payment of approximately €6,200.00</p></li>
    <li><p>• - A formal Reimbursement Invoice (Ref: INV-202612-OFC01)</p></li>
    <li><p><strong>Rent</strong>: 20%</p></li>
  </ul>`;

  const cleanedUl = cleanRedundantListMarkers(ulHtml);
  assert.ok(!cleanedUl.includes("<p>- The current"));
  assert.ok(!cleanedUl.includes("<p>• - A formal"));
  assert.ok(cleanedUl.includes("<p>The current company bank account balance stands at €8,673.66.</p>"));
  assert.ok(cleanedUl.includes("<p>A formal Reimbursement Invoice (Ref: INV-202612-OFC01)</p>"));
  assert.ok(cleanedUl.includes("<p><strong>Rent</strong>: 20%</p>"));

  // 2. <ol> items starting with "1. ", "2. ", "1. 1. ", or "- "
  const olHtml = `<ol>
    <li><p>1. The formal corporate procedure and documentation required from my side</p></li>
    <li><p>2. 2. The applicable withholding obligations, if any</p></li>
    <li><p>- Does this setup meet all accounting and Cyprus Tax Department requirements</p></li>
    <li><p>3. Once confirmed, when and how much I may formally transfer</p></li>
  </ol>`;

  const cleanedOl = cleanRedundantListMarkers(olHtml);
  assert.ok(!cleanedOl.includes("<p>1. The formal"));
  assert.ok(!cleanedOl.includes("<p>2. 2. The applicable"));
  assert.ok(!cleanedOl.includes("<p>- Does this setup"));
  assert.ok(!cleanedOl.includes("<p>3. Once confirmed"));
  assert.ok(cleanedOl.includes("<p>The formal corporate procedure and documentation required from my side</p>"));
  assert.ok(cleanedOl.includes("<p>The applicable withholding obligations, if any</p>"));
  assert.ok(cleanedOl.includes("<p>Does this setup meet all accounting and Cyprus Tax Department requirements</p>"));
  assert.ok(cleanedOl.includes("<p>Once confirmed, when and how much I may formally transfer</p>"));
});

test("normalizeTextForMarkdown: strips duplicate prefixes on plain text", () => {
  const input = "• - Item with double bullet\n1. 1. Item with double number\n1. - Item with number dash";
  const normalized = normalizeTextForMarkdown(input);
  assert.match(normalized, /^- Item with double bullet/m);
  assert.match(normalized, /^1\. Item with double number/m);
  assert.match(normalized, /^1\. Item with number dash/m);
});
