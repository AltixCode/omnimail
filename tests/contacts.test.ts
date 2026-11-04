import assert from "node:assert/strict";
import test from "node:test";
import { parseEmailContact, cleanEmailAddress } from "../src/lib/contacts";

test("parseEmailContact correctly parses plain email addresses", () => {
  const result = parseEmailContact("alice@example.com");
  assert.deepEqual(result, {
    address: "alice@example.com",
    name: null,
  });
});

test("parseEmailContact handles uppercase and extra spaces", () => {
  const result = parseEmailContact("   Bob.Smith@Domain.COM   ");
  assert.deepEqual(result, {
    address: "bob.smith@domain.com",
    name: null,
  });
});

test("parseEmailContact parses standard formatted name and angle brackets", () => {
  const result = parseEmailContact("John Doe <john.doe@example.org>");
  assert.deepEqual(result, {
    address: "john.doe@example.org",
    name: "John Doe",
  });
});

test("parseEmailContact parses quoted name with angle brackets", () => {
  const result = parseEmailContact('"Jane Smith" <jane.smith@sub.domain.co.uk>');
  assert.deepEqual(result, {
    address: "jane.smith@sub.domain.co.uk",
    name: "Jane Smith",
  });
});

test("parseEmailContact handles brackets with no display name", () => {
  const result = parseEmailContact("<contact@example.com>");
  assert.deepEqual(result, {
    address: "contact@example.com",
    name: null,
  });
});

test("cleanEmailAddress returns normalized address or null", () => {
  assert.equal(cleanEmailAddress("Dr. Who <doctor@tardis.org>"), "doctor@tardis.org");
  assert.equal(cleanEmailAddress("invalid-string-no-at"), null);
  assert.equal(cleanEmailAddress(""), null);
});

test("tokenizes recipient strings with commas and semicolons", () => {
  const input = "alice@example.com, bob@example.com; charlie@example.org";
  const parts = input.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
  const cleaned = parts.map((p) => cleanEmailAddress(p)).filter(Boolean);

  assert.deepEqual(cleaned, [
    "alice@example.com",
    "bob@example.com",
    "charlie@example.org",
  ]);
});

test("tokenizes recipient string ending with comma or semicolon", () => {
  const input1 = "user@domain.com,";
  const endsWithDelim1 = input1.endsWith(",") || input1.endsWith(";");
  const parts1 = input1.split(/[,;]/);
  const completed1 = endsWithDelim1 ? parts1 : parts1.slice(0, -1);
  const remainder1 = endsWithDelim1 ? "" : parts1[parts1.length - 1];

  assert.equal(endsWithDelim1, true);
  assert.equal(remainder1, "");
  assert.deepEqual(completed1.map((p) => cleanEmailAddress(p)).filter(Boolean), [
    "user@domain.com",
  ]);

  const input2 = "user@domain.com;";
  const endsWithDelim2 = input2.endsWith(",") || input2.endsWith(";");
  const parts2 = input2.split(/[,;]/);
  const completed2 = endsWithDelim2 ? parts2 : parts2.slice(0, -1);
  const remainder2 = endsWithDelim2 ? "" : parts2[parts2.length - 1];

  assert.equal(endsWithDelim2, true);
  assert.equal(remainder2, "");
  assert.deepEqual(completed2.map((p) => cleanEmailAddress(p)).filter(Boolean), [
    "user@domain.com",
  ]);
});

test("filters and ranks suggestions by prefix over substring", () => {
  const contacts = [
    { address: "sarah.connor@sky.net", name: "Sarah Connor", count: 2 },
    { address: "connor@resistance.org", name: "John Connor", count: 10 },
    { address: "al.connor@domain.com", name: "Al Connor", count: 1 },
  ];

  const query = "connor";
  // Prefix on address or name should beat non-prefix
  const scored = contacts
    .map((c) => {
      const addr = c.address.toLowerCase();
      const name = c.name?.toLowerCase() || "";
      let score = -1;
      if (addr.startsWith(query)) score = 100 + c.count;
      else if (name.startsWith(query) || name.split(/\s+/).some((p) => p.startsWith(query)))
        score = 80 + c.count;
      else if (addr.includes(query)) score = 50 + c.count;
      return { contact: c, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);

  // Both "connor@resistance.org" (addr starts with) and John Connor / Sarah Connor (name part starts with) match
  assert.equal(scored[0].contact.address, "connor@resistance.org");
});
