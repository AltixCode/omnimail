/**
 * Utilities for resolving email reply recipients.
 *
 * In email threads, quick replies, and reply composers, the recipient should
 * always be the other participant(s) in the conversation, never the current user.
 * Even when the latest message in a thread was sent by the user, replying must
 * target the other person (or recipients of the sent message).
 */

export interface ReplyTargetMessage {
  id?: string;
  fromAddress: string;
  fromName?: string | null;
  toAddresses?: string | null;
  ccAddresses?: string | null;
  replyTo?: string | null;
  account?: {
    emailAddress?: string | null;
  } | null;
}

export interface ResolveReplyOptions {
  targetMessage: ReplyTargetMessage;
  threadMessages?: ReplyTargetMessage[];
  userEmails?: string[];
}

export interface ResolvedReplyRecipients {
  /** Primary recipient email address (the other person) */
  toAddress: string;
  /** Friendly display name for UI (e.g., "Elena Tsakona" or email) */
  displayName: string;
  /** Primary recipients list for Reply All (typically [toAddress]) */
  replyAllTo: string[];
  /** Secondary CC recipients list for Reply All (excluding self and toAddress) */
  replyAllCc: string[];
}

/**
 * Extracts a normalized, lowercase email address without angle brackets or quotes.
 * e.g., "Elena Tsakona <etsakona@hfm.com>" -> "etsakona@hfm.com"
 */
export function cleanEmail(raw: string | null | undefined): string {
  if (!raw || typeof raw !== "string") return "";
  const trimmed = raw.trim();
  const match = trimmed.match(/<([^>]+)>/);
  const target = match ? match[1] : trimmed;
  return target.replace(/^["']|["']$/g, "").trim().toLowerCase();
}

export interface ParsedContact {
  address: string;
  name: string | null;
}

/**
 * Parse a single contact string into { address, name }.
 */
export function parseContact(raw: string | null | undefined): ParsedContact | null {
  if (!raw || typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Format: "Elena Tsakona" <etsakona@hfm.com> or Elena Tsakona <etsakona@hfm.com>
  const angleMatch = trimmed.match(/^(?:["']?([^"<>]*)["']?\s*)?<([^<>@\s]+@[^<>@\s]+)>$/);
  if (angleMatch) {
    const rawName = angleMatch[1]?.trim();
    const address = angleMatch[2].trim().toLowerCase();
    const name = rawName && rawName.length > 0 && rawName.toLowerCase() !== address ? rawName : null;
    return { address, name };
  }

  // Format: plain email or email enclosed in angle brackets
  const simpleMatch = trimmed.match(
    /([a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+)/
  );
  if (simpleMatch) {
    const address = simpleMatch[1].toLowerCase();
    let name: string | null = trimmed
      .replace(simpleMatch[0], "")
      .replace(/[<>"']/g, "")
      .trim();
    if (!name || name.toLowerCase() === address) name = null;
    return { address, name };
  }

  return null;
}

/**
 * Parse an address list string (JSON array or comma/semicolon separated).
 */
export function parseAddressList(raw: string | null | undefined): ParsedContact[] {
  if (!raw || typeof raw !== "string") return [];
  const trimmed = raw.trim();
  if (!trimmed) return [];

  // Check if JSON array string (e.g. '["etsakona@hfm.com"]' or '[{"address":"..."}]')
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        const results: ParsedContact[] = [];
        for (const item of parsed) {
          if (typeof item === "string") {
            const c = parseContact(item);
            if (c) results.push(c);
          } else if (item && typeof item === "object") {
            const addr = cleanEmail(item.address || item.email);
            if (addr) {
              const name =
                item.name && typeof item.name === "string" && item.name.trim().toLowerCase() !== addr
                  ? item.name.trim()
                  : null;
              results.push({ address: addr, name });
            }
          }
        }
        if (results.length > 0) return results;
      }
    } catch {
      // Fall through to delimiter split
    }
  }

  const parts = trimmed.split(/[,;]/);
  const results: ParsedContact[] = [];
  for (const part of parts) {
    const c = parseContact(part);
    if (c) results.push(c);
  }
  return results;
}

/**
 * Resolves the correct recipient(s) for replying to a message or thread.
 *
 * Rules:
 * 1. If targetMessage was sent by another person (!isUser):
 *    - To: targetMessage.replyTo (if valid & not user) || targetMessage.fromAddress
 *    - DisplayName: targetMessage.fromName || toAddress
 *    - ReplyAll CC: all recipients from targetMessage.toAddresses and ccAddresses, excluding self & toAddress
 *
 * 2. If targetMessage was sent by the user (isUser):
 *    - Check threadMessages backwards for the most recent message sent by someone else (!isUser).
 *      If found, that person is the primary recipient (toAddress + displayName).
 *    - If no earlier message in thread was from someone else (or no thread), check targetMessage.toAddresses.
 *      The first recipient that is not the user becomes the primary recipient.
 *    - If still no external recipient found, check targetMessage.ccAddresses.
 *    - Fallback (e.g. Note to Self sent to oneself): targetMessage.fromAddress.
 *    - ReplyAll: collects all external recipients from targetMessage.toAddresses, ccAddresses,
 *      and other thread participants, excluding the user.
 */
export function resolveReplyRecipients(options: ResolveReplyOptions): ResolvedReplyRecipients {
  const { targetMessage, threadMessages = [], userEmails = [] } = options;

  const userEmailSet = new Set<string>();
  for (const email of userEmails) {
    const clean = cleanEmail(email);
    if (clean) userEmailSet.add(clean);
  }
  if (targetMessage.account?.emailAddress) {
    const clean = cleanEmail(targetMessage.account.emailAddress);
    if (clean) userEmailSet.add(clean);
  }

  const isUser = (email: string | null | undefined): boolean => {
    if (!email) return false;
    const clean = cleanEmail(email);
    return clean ? userEmailSet.has(clean) : false;
  };

  const targetFromClean = cleanEmail(targetMessage.fromAddress);
  const targetSentBySelf = isUser(targetFromClean);

  if (!targetSentBySelf) {
    // -------------------------------------------------------------
    // Case 1: Target message was sent by someone other than the user
    // -------------------------------------------------------------
    const replyToClean = cleanEmail(targetMessage.replyTo);
    const primaryAddress =
      replyToClean && !isUser(replyToClean) ? replyToClean : targetFromClean;

    let displayName = primaryAddress;
    if (
      targetMessage.fromName &&
      targetMessage.fromName.trim() &&
      targetMessage.fromName.trim().toLowerCase() !== primaryAddress
    ) {
      displayName = targetMessage.fromName.trim();
    }

    // For Reply All:
    const toContacts = parseAddressList(targetMessage.toAddresses);
    const ccContacts = parseAddressList(targetMessage.ccAddresses);
    const seen = new Set<string>([primaryAddress]);

    const replyAllCc: string[] = [];
    for (const c of [...toContacts, ...ccContacts]) {
      const addr = cleanEmail(c.address);
      if (addr && !isUser(addr) && !seen.has(addr)) {
        seen.add(addr);
        replyAllCc.push(addr);
      }
    }

    return {
      toAddress: primaryAddress,
      displayName,
      replyAllTo: primaryAddress ? [primaryAddress] : [],
      replyAllCc,
    };
  }

  // -----------------------------------------------------------------
  // Case 2: Target message was sent by the user (or one of user's accounts)
  // We must reply to "the other person not me".
  // -----------------------------------------------------------------

  let otherPersonAddress = "";
  let otherPersonName: string | null = null;

  // 1. Look backwards through threadMessages for the latest message from someone else
  if (threadMessages && threadMessages.length > 0) {
    for (let i = threadMessages.length - 1; i >= 0; i--) {
      const msg = threadMessages[i];
      const msgFromClean = cleanEmail(msg.fromAddress);
      if (msgFromClean && !isUser(msgFromClean)) {
        const msgReplyToClean = cleanEmail(msg.replyTo);
        otherPersonAddress =
          msgReplyToClean && !isUser(msgReplyToClean) ? msgReplyToClean : msgFromClean;
        if (
          msg.fromName &&
          msg.fromName.trim() &&
          msg.fromName.trim().toLowerCase() !== otherPersonAddress
        ) {
          otherPersonName = msg.fromName.trim();
        }
        break;
      }
    }
  }

  // 2. If not found in thread, check targetMessage.toAddresses for an external recipient
  const targetToContacts = parseAddressList(targetMessage.toAddresses);
  if (!otherPersonAddress) {
    for (const c of targetToContacts) {
      const addr = cleanEmail(c.address);
      if (addr && !isUser(addr)) {
        otherPersonAddress = addr;
        otherPersonName = c.name;
        break;
      }
    }
  }

  // 3. If still not found, check targetMessage.ccAddresses
  const targetCcContacts = parseAddressList(targetMessage.ccAddresses);
  if (!otherPersonAddress) {
    for (const c of targetCcContacts) {
      const addr = cleanEmail(c.address);
      if (addr && !isUser(addr)) {
        otherPersonAddress = addr;
        otherPersonName = c.name;
        break;
      }
    }
  }

  // 4. Absolute fallback (e.g. note to self)
  if (!otherPersonAddress) {
    otherPersonAddress = targetFromClean || cleanEmail(targetMessage.toAddresses) || "me";
    otherPersonName = targetMessage.fromName?.trim() || null;
  }

  const displayName =
    otherPersonName &&
    otherPersonName.trim().length > 0 &&
    otherPersonName.trim().toLowerCase() !== otherPersonAddress
      ? otherPersonName.trim()
      : otherPersonAddress;

  // Build Reply All recipients:
  // Primary other person in replyAllTo, all other external recipients in replyAllCc
  const seenAll = new Set<string>();
  const replyAllTo: string[] = [];

  if (otherPersonAddress && !isUser(otherPersonAddress)) {
    seenAll.add(otherPersonAddress);
    replyAllTo.push(otherPersonAddress);
  }

  const replyAllCc: string[] = [];

  // Add remaining external recipients from target message
  for (const c of [...targetToContacts, ...targetCcContacts]) {
    const addr = cleanEmail(c.address);
    if (addr && !isUser(addr) && !seenAll.has(addr)) {
      seenAll.add(addr);
      replyAllCc.push(addr);
    }
  }

  // Also collect any other participants from earlier thread messages if not already seen
  if (threadMessages && threadMessages.length > 0) {
    for (const msg of threadMessages) {
      const fromAddr = cleanEmail(msg.fromAddress);
      if (fromAddr && !isUser(fromAddr) && !seenAll.has(fromAddr)) {
        seenAll.add(fromAddr);
        replyAllCc.push(fromAddr);
      }
      for (const c of [
        ...parseAddressList(msg.toAddresses),
        ...parseAddressList(msg.ccAddresses),
      ]) {
        const addr = cleanEmail(c.address);
        if (addr && !isUser(addr) && !seenAll.has(addr)) {
          seenAll.add(addr);
          replyAllCc.push(addr);
        }
      }
    }
  }

  return {
    toAddress: otherPersonAddress,
    displayName,
    replyAllTo: replyAllTo.length > 0 ? replyAllTo : [otherPersonAddress],
    replyAllCc,
  };
}
