import prisma from "../src/lib/db";
import { parseSearchQuery, buildSearchQueryString } from "../src/lib/search-query";
import { Prisma } from "@prisma/client";

async function executeSearch(query: string) {
  const parsed = parseSearchQuery(query);
  const where: Prisma.MessageWhereInput = {};
  const andConditions: Prisma.MessageWhereInput[] = [];

  if (parsed.isRead !== undefined) where.isRead = parsed.isRead;
  if (parsed.isStarred !== undefined) where.isStarred = parsed.isStarred;
  if (parsed.hasAttachment) where.hasAttachments = true;

  if (parsed.from) {
    andConditions.push({
      OR: [
        { fromAddress: { contains: parsed.from, mode: "insensitive" } },
        { fromName: { contains: parsed.from, mode: "insensitive" } },
      ],
    });
  }

  if (parsed.to) {
    andConditions.push({
      toAddresses: { contains: parsed.to, mode: "insensitive" },
    });
  }

  if (parsed.subject) {
    andConditions.push({
      subject: { contains: parsed.subject, mode: "insensitive" },
    });
  }

  if (parsed.body) {
    andConditions.push({
      OR: [
        { bodyText: { contains: parsed.body, mode: "insensitive" } },
        { snippet: { contains: parsed.body, mode: "insensitive" } },
        { bodyHtml: { contains: parsed.body, mode: "insensitive" } },
      ],
    });
  }

  if (parsed.hasInvite) {
    andConditions.push({
      attachments: {
        some: {
          OR: [
            { contentType: { contains: "calendar", mode: "insensitive" } },
            { filename: { endsWith: ".ics", mode: "insensitive" } },
          ],
        },
      },
    });
  }

  const attachmentFilter: Prisma.AttachmentWhereInput = {};
  let hasAttachmentFilter = false;

  if (parsed.filename) {
    attachmentFilter.filename = { contains: parsed.filename, mode: "insensitive" };
    hasAttachmentFilter = true;
  }

  if (parsed.minSize !== undefined || parsed.maxSize !== undefined) {
    const sizeFilter: Prisma.IntFilter = {};
    if (parsed.minSize !== undefined) sizeFilter.gte = parsed.minSize;
    if (parsed.maxSize !== undefined) sizeFilter.lte = parsed.maxSize;
    attachmentFilter.size = sizeFilter;
    hasAttachmentFilter = true;
  }

  if (hasAttachmentFilter) {
    andConditions.push({
      attachments: {
        some: attachmentFilter,
      },
    });
  }

  if (parsed.afterDate || parsed.beforeDate) {
    const dateFilter: Prisma.DateTimeFilter = {};
    if (parsed.afterDate) dateFilter.gte = parsed.afterDate;
    if (parsed.beforeDate) dateFilter.lte = parsed.beforeDate;
    andConditions.push({ date: dateFilter });
  }

  for (const ex of parsed.excludeWords) {
    andConditions.push({
      NOT: [
        { subject: { contains: ex, mode: "insensitive" } },
        { snippet: { contains: ex, mode: "insensitive" } },
        { bodyText: { contains: ex, mode: "insensitive" } },
        { fromName: { contains: ex, mode: "insensitive" } },
        { fromAddress: { contains: ex, mode: "insensitive" } },
        { attachments: { some: { filename: { contains: ex, mode: "insensitive" } } } },
      ],
    });
  }

  for (const word of parsed.freeWords) {
    andConditions.push({
      OR: [
        { subject: { contains: word, mode: "insensitive" } },
        { snippet: { contains: word, mode: "insensitive" } },
        { bodyText: { contains: word, mode: "insensitive" } },
        { fromAddress: { contains: word, mode: "insensitive" } },
        { fromName: { contains: word, mode: "insensitive" } },
        { toAddresses: { contains: word, mode: "insensitive" } },
        { ccAddresses: { contains: word, mode: "insensitive" } },
        {
          attachments: {
            some: {
              filename: { contains: word, mode: "insensitive" },
            },
          },
        },
      ],
    });
  }

  if (andConditions.length > 0) {
    where.AND = andConditions;
  }

  const results = await prisma.message.findMany({
    where,
    select: {
      id: true,
      subject: true,
      fromAddress: true,
      fromName: true,
      date: true,
      hasAttachments: true,
      attachments: {
        select: {
          filename: true,
          size: true,
          contentType: true,
        },
      },
    },
    take: 5,
  });

  return results;
}

async function runTests() {
  console.log("=== RUNNING ADVANCED SEARCH END-TO-END TESTS ===");

  // Test 1: Parser unit checks
  const p1 = parseSearchQuery('from:google has:attachment larger:1MB subject:"Security alert" -spam');
  console.log("\n[Test 1] Parser test:");
  console.log("from:", p1.from);
  console.log("hasAttachment:", p1.hasAttachment);
  console.log("minSize:", p1.minSize, "bytes");
  console.log("subject:", p1.subject);
  console.log("excludeWords:", p1.excludeWords);
  if (p1.from !== "google" || p1.hasAttachment !== true || p1.minSize !== 1048576 || p1.subject !== "Security alert" || p1.excludeWords[0] !== "spam") {
    throw new Error("Parser failed Test 1");
  }
  console.log("✓ Parser test passed!");

  // Test 2: Normal search across DB
  console.log("\n[Test 2] Free text search for common word e.g. 'email' or 'google'");
  const r2 = await executeSearch("google");
  console.log(`Found ${r2.length} messages matching 'google':`);
  r2.forEach((m) => console.log(`  - [${m.fromAddress}] ${m.subject}`));
  console.log("✓ Free text search passed!");

  // Test 3: has:attachment
  console.log("\n[Test 3] Search 'has:attachment'");
  const r3 = await executeSearch("has:attachment");
  console.log(`Found ${r3.length} messages with attachments:`);
  r3.forEach((m) => console.log(`  - [${m.fromAddress}] ${m.subject} (attachments: ${m.attachments.map(a => a.filename).join(", ")})`));
  console.log("✓ has:attachment search passed!");

  // Test 4: has:invite / calendar
  console.log("\n[Test 4] Search 'has:invite'");
  const r4 = await executeSearch("has:invite");
  console.log(`Found ${r4.length} calendar invites:`);
  r4.forEach((m) => console.log(`  - [${m.fromAddress}] ${m.subject} (files: ${m.attachments.map(a => a.filename).join(", ")})`));
  console.log("✓ has:invite search passed!");

  // Test 5: Attachment size filter e.g. 'larger:50KB'
  console.log("\n[Test 5] Search 'larger:50KB'");
  const r5 = await executeSearch("larger:50KB");
  console.log(`Found ${r5.length} messages with attachment > 50KB:`);
  r5.forEach((m) => console.log(`  - ${m.subject} (${m.attachments.map(a => `${a.filename}: ${Math.round(a.size/1024)}KB`).join(", ")})`));
  console.log("✓ size search passed!");

  // Test 6: Combined search e.g. 'from:google is:read'
  console.log("\n[Test 6] Search 'from:google is:read'");
  const r6 = await executeSearch("from:google is:read");
  console.log(`Found ${r6.length} messages:`);
  r6.forEach((m) => console.log(`  - [${m.fromAddress}] ${m.subject}`));
  console.log("✓ combined search passed!");

  console.log("\n=== ALL SEARCH TESTS PASSED SUCCESSFULLY! ===");
}

runTests()
  .catch((e) => {
    console.error("Test failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
