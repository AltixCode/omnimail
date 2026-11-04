import prisma from "./db";

export interface ContactEntry {
  address: string;
  name?: string | null;
  lastContactedAt?: string | null;
  count: number;
}

export interface ParseContactResult {
  address: string;
  name: string | null;
}

// Clean and validate an email address string
export function cleanEmailAddress(raw: string): string | null {
  if (!raw || typeof raw !== "string") return null;
  const parsed = parseEmailContact(raw);
  return parsed ? parsed.address : null;
}

// Parse email strings like "John Doe <john@doe.com>" or "john@doe.com"
export function parseEmailContact(raw: string): ParseContactResult | null {
  if (!raw || typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Format: "Name" <email@domain.com> or Name <email@domain.com>
  const angleMatch = trimmed.match(/^(?:["']?([^"<>]*)["']?\s*)?<([^<>@\s]+@[^<>@\s]+)>$/);
  if (angleMatch) {
    const rawName = angleMatch[1]?.trim();
    const address = angleMatch[2].trim().toLowerCase();
    const name = rawName && rawName.length > 0 && rawName !== address ? rawName : null;
    return { address, name };
  }

  // Format: plain email or email enclosed in angle brackets
  const simpleMatch = trimmed.match(/([a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+)/);
  if (simpleMatch) {
    const address = simpleMatch[1].toLowerCase();
    let name: string | null = trimmed
      .replace(simpleMatch[0], "")
      .replace(/[<>"']/g, "")
      .trim();
    if (!name || name === address) name = null;
    return { address, name };
  }

  return null;
}

// In-memory cache for fast contact auto-complete queries
interface CachedUserContacts {
  timestamp: number;
  contacts: ContactEntry[];
}

const userContactsCache = new Map<string, CachedUserContacts>();
const CACHE_TTL_MS = 60 * 1000; // 60 seconds

// Filter out system and robot addresses
function isIgnoredAddress(address: string): boolean {
  const lower = address.toLowerCase();
  return (
    lower.startsWith("mailer-daemon@") ||
    lower.startsWith("postmaster@") ||
    lower.includes("no-reply") ||
    lower.includes("noreply") ||
    lower === "unknown@sender.com"
  );
}

// Parse a JSON or comma-separated string of addresses
function parseAddressesList(raw: string | null | undefined): ParseContactResult[] {
  if (!raw) return [];
  const results: ParseContactResult[] = [];

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        if (typeof item === "string") {
          const contact = parseEmailContact(item);
          if (contact) results.push(contact);
        } else if (item && typeof item === "object" && item.address) {
          const contact = parseEmailContact(item.address);
          if (contact) {
            results.push({
              address: contact.address,
              name: item.name || contact.name,
            });
          }
        }
      }
      return results;
    }
  } catch {
    // Fall back to comma-separated
  }

  const parts = raw.split(/[,;]/);
  for (const part of parts) {
    const contact = parseEmailContact(part);
    if (contact) results.push(contact);
  }

  return results;
}

// Build contact entries from user's sent and received messages
export async function getContactsForUser(
  userId: string,
  options?: { query?: string; limit?: number; bypassCache?: boolean }
): Promise<ContactEntry[]> {
  const query = options?.query?.trim().toLowerCase();
  const limit = Math.max(1, Math.min(100, options?.limit || 30));

  let cached = userContactsCache.get(userId);
  const now = Date.now();

  if (!cached || options?.bypassCache || now - cached.timestamp > CACHE_TTL_MS) {
    const messages = await prisma.message.findMany({
      where: {
        account: { userId },
      },
      select: {
        fromAddress: true,
        fromName: true,
        toAddresses: true,
        ccAddresses: true,
        bccAddresses: true,
        date: true,
      },
      orderBy: {
        date: "desc",
      },
      take: 1200,
    });

    const contactMap = new Map<string, ContactEntry>();

    for (const msg of messages) {
      const msgDateStr = msg.date ? msg.date.toISOString() : new Date().toISOString();

      // 1. Process fromAddress (received or sent)
      if (msg.fromAddress) {
        const fromParsed = parseEmailContact(msg.fromAddress);
        if (fromParsed && !isIgnoredAddress(fromParsed.address)) {
          const addr = fromParsed.address;
          const name = msg.fromName || fromParsed.name;
          const existing = contactMap.get(addr);
          if (existing) {
            existing.count += 1;
            if (!existing.name && name) existing.name = name;
            if (!existing.lastContactedAt || msgDateStr > existing.lastContactedAt) {
              existing.lastContactedAt = msgDateStr;
            }
          } else {
            contactMap.set(addr, {
              address: addr,
              name: name || null,
              lastContactedAt: msgDateStr,
              count: 1,
            });
          }
        }
      }

      // 2. Process toAddresses
      const toList = parseAddressesList(msg.toAddresses);
      for (const toItem of toList) {
        if (isIgnoredAddress(toItem.address)) continue;
        const addr = toItem.address;
        const existing = contactMap.get(addr);
        if (existing) {
          existing.count += 1;
          if (!existing.name && toItem.name) existing.name = toItem.name;
          if (!existing.lastContactedAt || msgDateStr > existing.lastContactedAt) {
            existing.lastContactedAt = msgDateStr;
          }
        } else {
          contactMap.set(addr, {
            address: addr,
            name: toItem.name,
            lastContactedAt: msgDateStr,
            count: 1,
          });
        }
      }

      // 3. Process ccAddresses
      const ccList = parseAddressesList(msg.ccAddresses);
      for (const ccItem of ccList) {
        if (isIgnoredAddress(ccItem.address)) continue;
        const addr = ccItem.address;
        const existing = contactMap.get(addr);
        if (existing) {
          existing.count += 1;
          if (!existing.name && ccItem.name) existing.name = ccItem.name;
          if (!existing.lastContactedAt || msgDateStr > existing.lastContactedAt) {
            existing.lastContactedAt = msgDateStr;
          }
        } else {
          contactMap.set(addr, {
            address: addr,
            name: ccItem.name,
            lastContactedAt: msgDateStr,
            count: 1,
          });
        }
      }

      // 4. Process bccAddresses
      const bccList = parseAddressesList(msg.bccAddresses);
      for (const bccItem of bccList) {
        if (isIgnoredAddress(bccItem.address)) continue;
        const addr = bccItem.address;
        const existing = contactMap.get(addr);
        if (existing) {
          existing.count += 1;
          if (!existing.name && bccItem.name) existing.name = bccItem.name;
          if (!existing.lastContactedAt || msgDateStr > existing.lastContactedAt) {
            existing.lastContactedAt = msgDateStr;
          }
        } else {
          contactMap.set(addr, {
            address: addr,
            name: bccItem.name,
            lastContactedAt: msgDateStr,
            count: 1,
          });
        }
      }
    }

    // Sort contacts by frequency & recency
    const sorted = Array.from(contactMap.values()).sort((a, b) => {
      // Frequency has high weight, recency breaks ties
      if (b.count !== a.count) return b.count - a.count;
      const dateA = a.lastContactedAt ? new Date(a.lastContactedAt).getTime() : 0;
      const dateB = b.lastContactedAt ? new Date(b.lastContactedAt).getTime() : 0;
      return dateB - dateA;
    });

    cached = { timestamp: now, contacts: sorted };
    userContactsCache.set(userId, cached);
  }

  const allContacts = cached.contacts;

  if (!query) {
    return allContacts.slice(0, limit);
  }

  // Rank matches:
  // 1. Exact email prefix match (e.g. query "ali" matches "alice@...")
  // 2. Exact name prefix match (e.g. query "ali" matches "Alice Smith")
  // 3. Email substring match
  // 4. Name substring match
  const scored = allContacts
    .map((c) => {
      const addr = c.address.toLowerCase();
      const name = c.name?.toLowerCase() || "";
      let score = -1;

      if (addr.startsWith(query)) {
        score = 100 + (c.count || 1);
      } else if (name.startsWith(query) || name.split(/\s+/).some((part) => part.startsWith(query))) {
        score = 80 + (c.count || 1);
      } else if (addr.includes(query)) {
        score = 50 + (c.count || 1);
      } else if (name.includes(query)) {
        score = 30 + (c.count || 1);
      }

      return { contact: c, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((item) => item.contact);

  return scored.slice(0, limit);
}

// Immediately record sent recipients to user's contact memory
export function recordSentContacts(userId: string, recipients: string[]): void {
  if (!recipients || recipients.length === 0) return;

  const cached = userContactsCache.get(userId);
  const nowStr = new Date().toISOString();

  const contactsList = cached ? [...cached.contacts] : [];
  const map = new Map<string, ContactEntry>();
  for (const c of contactsList) {
    map.set(c.address, c);
  }

  for (const raw of recipients) {
    const parsed = parseEmailContact(raw);
    if (!parsed || isIgnoredAddress(parsed.address)) continue;

    const existing = map.get(parsed.address);
    if (existing) {
      existing.count += 2; // Sent messages give higher weight
      if (parsed.name && !existing.name) existing.name = parsed.name;
      existing.lastContactedAt = nowStr;
    } else {
      const newEntry: ContactEntry = {
        address: parsed.address,
        name: parsed.name,
        lastContactedAt: nowStr,
        count: 2,
      };
      map.set(parsed.address, newEntry);
      contactsList.unshift(newEntry);
    }
  }

  const updatedSorted = Array.from(map.values()).sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    const dateA = a.lastContactedAt ? new Date(a.lastContactedAt).getTime() : 0;
    const dateB = b.lastContactedAt ? new Date(b.lastContactedAt).getTime() : 0;
    return dateB - dateA;
  });

  userContactsCache.set(userId, {
    timestamp: Date.now(),
    contacts: updatedSorted,
  });
}
