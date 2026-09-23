import { prisma } from "../src/lib/db";
import { encryptSecret, decryptSecret } from "../src/lib/crypto";
import eventBus from "../src/server/event-bus";

async function runVerification() {
  console.log("=== OmniMail Autonomous Verification Suite ===");

  // 1. Test Crypto Vault
  console.log("\n1. Testing AES-256-GCM Vault...");
  const secret = "SuperSecretPassword123!@#";
  const encrypted = encryptSecret(secret);
  const decrypted = decryptSecret(encrypted);
  if (decrypted !== secret) {
    throw new Error(`Crypto verification failed! Expected ${secret}, got ${decrypted}`);
  }
  console.log("✓ AES-256-GCM encryption & decryption verified.");

  // 2. Test Database Records
  console.log("\n2. Testing Database Entities...");
  const accounts = await prisma.mailAccount.findMany({
    include: { folders: true, calendars: true },
  });
  console.log(`✓ Found ${accounts.length} connected mail accounts.`);
  for (const acc of accounts) {
    console.log(`  - ${acc.label} (${acc.emailAddress}) with ${acc.folders.length} folders`);
  }

  const messages = await prisma.message.findMany({
    take: 5,
    include: { attachments: true, account: true },
  });
  console.log(`✓ Found ${messages.length} messages in database.`);
  for (const msg of messages) {
    console.log(`  - [${msg.account.label}] "${msg.subject}" from ${msg.fromAddress} (Starred: ${msg.isStarred}, Attachments: ${msg.attachments.length})`);
  }

  // 3. Test Full-Text & Query Search
  console.log("\n3. Testing Message Search Engine...");
  const searchResults = await prisma.message.findMany({
    where: {
      OR: [
        { subject: { contains: "Architecture", mode: "insensitive" } },
        { snippet: { contains: "Architecture", mode: "insensitive" } },
      ],
    },
  });
  console.log(`✓ Search for "Architecture" returned ${searchResults.length} matching message(s).`);

  // 4. Test Calendar Collections & Events
  console.log("\n4. Testing Calendar Engine...");
  const events = await prisma.calendarEvent.findMany({
    include: { calendar: true },
  });
  console.log(`✓ Found ${events.length} calendar events.`);
  for (const ev of events) {
    console.log(`  - "${ev.summary}" at ${ev.startDate.toISOString()} (${ev.calendar.name})`);
  }

  // 5. Test Real-time Event Bus
  console.log("\n5. Testing Real-time Event Streaming Bus...");
  let eventReceived = false;
  const testHandler = (payload: any) => {
    if (payload.type === "new-message" && payload.data?.test === true) {
      eventReceived = true;
    }
  };
  eventBus.on("stream-event", testHandler);
  eventBus.broadcast("new-message", { test: true });
  eventBus.off("stream-event", testHandler);

  if (!eventReceived) {
    throw new Error("Event bus failed to broadcast stream event!");
  }
  console.log("✓ Real-time EventBus SSE stream broadcasting verified.");

  console.log("\n=== All Verification Tests Passed Successfully! ===");
}

runVerification()
  .catch((err) => {
    console.error("Verification failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
