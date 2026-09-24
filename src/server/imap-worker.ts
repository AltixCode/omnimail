import { ImapFlow } from "imapflow";
import { simpleParser, ParsedMail } from "mailparser";
import prisma from "@/lib/db";
import { decryptSecret } from "@/lib/crypto";
import eventBus from "./event-bus";

interface ActiveWorker {
  client: ImapFlow;
  isIdling: boolean;
  abortController: AbortController;
  retryTimer?: NodeJS.Timeout;
  pollingTimer?: NodeJS.Timeout;
}

class ImapWorkerPool {
  private workers: Map<string, ActiveWorker> = new Map();
  private syncingAccounts: Set<string> = new Set();

  private createClient(account: {
    id: string;
    imapHost: string;
    imapPort: number;
    imapSecure: boolean;
    imapUser: string;
    imapPassEnc: string;
  }): ImapFlow {
    let password = decryptSecret(account.imapPassEnc);
    if (account.imapHost.includes("gmail.com") && password) {
      const clean = password.replace(/\s+/g, "");
      if (clean.length === 16) {
        password = clean;
      }
    }
    const client = new ImapFlow({
      host: account.imapHost,
      port: account.imapPort,
      secure: account.imapSecure,
      auth: {
        user: account.imapUser,
        pass: password,
      },
      logger: false,
      emitLogs: false,
      clientInfo: {
        name: "OmniMail",
        version: "1.0.0",
      },
    });

    client.on("error", (err: any) => {
      console.warn(`[IMAP client error: ${account.imapUser}]`, err?.message || err);
    });

    return client;
  }

  /**
   * Syncs all folders and new messages for an account
   */
  async syncAccount(accountId: string): Promise<{ success: boolean; newCount: number; error?: string }> {
    if (this.syncingAccounts.has(accountId)) {
      return { success: true, newCount: 0 };
    }

    this.syncingAccounts.add(accountId);
    eventBus.broadcast("sync-status", { accountId, status: "syncing" });

    try {
      const account = await prisma.mailAccount.findUnique({
        where: { id: accountId },
      });

      if (!account || !account.syncActive) {
        this.syncingAccounts.delete(accountId);
        return { success: false, newCount: 0, error: "Account not found or sync disabled" };
      }

      const client = this.createClient(account);
      await client.connect();

      // 1. Fetch mailboxes & sync Folder records
      const mailboxes = await client.list();
      const folderMap = new Map<string, string>();

      for (const mbox of mailboxes) {
        let specialUse: string | null = null;
        if (mbox.specialUse) {
          specialUse = mbox.specialUse;
        } else if (mbox.path.toUpperCase() === "INBOX") {
          specialUse = "\\Inbox";
        }

        const folder = await prisma.folder.upsert({
          where: {
            accountId_path: {
              accountId: account.id,
              path: mbox.path,
            },
          },
          update: {
            name: mbox.name || mbox.path,
            specialUse,
          },
          create: {
            accountId: account.id,
            name: mbox.name || mbox.path,
            path: mbox.path,
            specialUse,
          },
        });

        folderMap.set(mbox.path, folder.id);
      }

      // 2. Sync INBOX and other key folders
      let totalNewMessages = 0;
      
      // Prioritize INBOX, Sent, Archive, Trash
      for (const mbox of mailboxes) {
        // Skip selectable=false
        if (mbox.flags && mbox.flags.has("\\Noselect")) continue;

        const folderId = folderMap.get(mbox.path);
        if (!folderId) continue;

        const specialUse = mbox.specialUse || (mbox.path.toUpperCase() === "INBOX" ? "\\Inbox" : null);

        // Apply folder scope preference
        const scope = account.syncFolderScope || "all";
        if (scope === "inbox_only" && specialUse !== "\\Inbox") {
          continue;
        }
        if (scope === "inbox_sent" && specialUse !== "\\Inbox" && specialUse !== "\\Sent") {
          continue;
        }

        try {
          const lock = await client.getMailboxLock(mbox.path);
          try {
            const mailboxStatus = client.mailbox;
            if (!mailboxStatus) continue;

            // Get existing UIDs from DB
            const existing = await prisma.message.findMany({
              where: { folderId },
              select: { uid: true },
            });
            const existingUidSet = new Set(existing.map((m) => m.uid));

            // Fetch UIDs in mailbox (custom limit per account)
            const uidsResult = await client.search({ all: true }, { uid: true });
            const remoteUids = Array.isArray(uidsResult) ? (uidsResult as number[]) : [];
            
            // Limit to target messages per account setting (default 100)
            const maxLimit = account.syncMaxMessages ?? 100;
            const targetUids = maxLimit > 0 ? remoteUids.slice(-maxLimit) : remoteUids;
            const missingUids = targetUids.filter((uid) => !existingUidSet.has(uid));

            // Process missing in batches
            for (let i = 0; i < missingUids.length; i += 10) {
              const batch = missingUids.slice(i, i + 10);
              for (const uid of batch) {
                try {
                  const download = await client.download(String(uid), undefined, { uid: true });
                  if (!download || !download.content) continue;

                  const parsed: ParsedMail = await simpleParser(download.content);

                  const fromAddress = parsed.from?.value?.[0]?.address || "unknown@sender.com";
                  const fromName = parsed.from?.value?.[0]?.name || null;
                  
                  const toAddresses = JSON.stringify(
                    parsed.to ? (Array.isArray(parsed.to) ? parsed.to : [parsed.to]).flatMap((t) => t.value.map((v) => v.address)) : []
                  );
                  const ccAddresses = parsed.cc
                    ? JSON.stringify((Array.isArray(parsed.cc) ? parsed.cc : [parsed.cc]).flatMap((c) => c.value.map((v) => v.address)))
                    : null;
                  const bccAddresses = parsed.bcc
                    ? JSON.stringify((Array.isArray(parsed.bcc) ? parsed.bcc : [parsed.bcc]).flatMap((b) => b.value.map((v) => v.address)))
                    : null;
                  const replyTo = parsed.replyTo?.value?.[0]?.address || null;

                  const subject = parsed.subject || "(No Subject)";
                  const date = parsed.date || new Date();
                  const bodyText = parsed.text || "";
                  const bodyHtml = (parsed.html as string) || (parsed.textAsHtml as string) || "";
                  const snippet = bodyText
                    ? bodyText.replace(/\s+/g, " ").trim().slice(0, 250)
                    : subject.slice(0, 250);

                  const hasAttachments = Boolean(parsed.attachments && parsed.attachments.length > 0);

                  const newMessage = await prisma.message.create({
                    data: {
                      accountId: account.id,
                      folderId,
                      uid,
                      messageId: parsed.messageId || null,
                      threadId: parsed.inReplyTo || parsed.messageId || null,
                      fromAddress,
                      fromName,
                      toAddresses,
                      ccAddresses,
                      bccAddresses,
                      replyTo,
                      subject,
                      date,
                      snippet,
                      bodyText,
                      bodyHtml,
                      isRead: false,
                      isStarred: false,
                      hasAttachments,
                      rawHeaders: JSON.stringify(parsed.headerLines || []),
                      attachments: hasAttachments
                        ? {
                            create: parsed.attachments.map((att) => ({
                              filename: att.filename || "attachment",
                              contentType: att.contentType || "application/octet-stream",
                              size: att.size || att.content.length,
                              contentId: att.cid || null,
                              // Store attachments up to 25MB as base64 for instant preview and download
                              dataBase64:
                                att.content.length < 25 * 1024 * 1024
                                  ? att.content.toString("base64")
                                  : null,
                            })),
                          }
                        : undefined,
                    },
                  });

                  totalNewMessages++;

                  // Stream new message event in real-time
                  eventBus.broadcast("new-message", {
                    accountId: account.id,
                    folderId,
                    message: {
                      id: newMessage.id,
                      accountId: account.id,
                      folderId,
                      uid: newMessage.uid,
                      messageId: newMessage.messageId,
                      threadId: newMessage.threadId,
                      fromAddress: newMessage.fromAddress,
                      fromName: newMessage.fromName,
                      toAddresses: newMessage.toAddresses,
                      subject: newMessage.subject,
                      date: newMessage.date.toISOString(),
                      snippet: newMessage.snippet,
                      hasAttachments: newMessage.hasAttachments,
                      isRead: false,
                      isStarred: false,
                      account: {
                        label: account.label,
                        emailAddress: account.emailAddress,
                      },
                      folder: {
                        name: mbox.name || mbox.path,
                        specialUse,
                      },
                    },
                  });
                } catch (msgErr) {
                  console.error(`Error parsing message UID ${uid}:`, msgErr);
                }
              }
            }

            // Recalculate unread and total count for folder
            const [unreadCount, totalCount] = await Promise.all([
              prisma.message.count({ where: { folderId, isRead: false } }),
              prisma.message.count({ where: { folderId } }),
            ]);

            await prisma.folder.update({
              where: { id: folderId },
              data: { unreadCount, totalCount },
            });

            eventBus.broadcast("folder-updated", { folderId, unreadCount, totalCount });
          } finally {
            lock.release();
          }
        } catch (folderErr) {
          console.error(`Error syncing folder ${mbox.path}:`, folderErr);
        }
      }

      await client.logout();

      await prisma.mailAccount.update({
        where: { id: accountId },
        data: {
          lastSyncAt: new Date(),
          syncStatus: "idle",
          lastError: null,
        },
      });

      eventBus.broadcast("sync-status", { accountId, status: "idle", newCount: totalNewMessages });
      return { success: true, newCount: totalNewMessages };
    } catch (err: any) {
      let errorMsg = err?.responseText || err?.message || String(err);
      if (errorMsg.includes("Command failed") || errorMsg.includes("AUTHENTICATIONFAILED") || errorMsg.includes("Invalid credentials")) {
        try {
          const accCheck = await prisma.mailAccount.findUnique({ where: { id: accountId }, select: { imapHost: true } });
          if (accCheck?.imapHost?.includes("gmail.com")) {
            errorMsg = "Gmail authentication failed: A 16-character App Password is required from myaccount.google.com/apppasswords";
          }
        } catch {}
      }
      console.error(`Sync failed for account ${accountId}:`, errorMsg);

      await prisma.mailAccount.update({
        where: { id: accountId },
        data: {
          syncStatus: "error",
          lastError: errorMsg,
        },
      });

      eventBus.broadcast("sync-status", { accountId, status: "error", error: errorMsg });
      return { success: false, newCount: 0, error: errorMsg };
    } finally {
      this.syncingAccounts.delete(accountId);
    }
  }

  /**
   * Starts an active IMAP connection with IDLE push and/or periodic polling
   */
  async startIdle(accountId: string) {
    if (this.workers.has(accountId)) {
      const existing = this.workers.get(accountId)!;
      if (existing.isIdling || existing.pollingTimer) return;
    }

    try {
      const account = await prisma.mailAccount.findUnique({
        where: { id: accountId },
      });

      if (!account || !account.syncActive) return;

      const client = this.createClient(account);
      const abortController = new AbortController();

      const worker: ActiveWorker = {
        client,
        isIdling: false,
        abortController,
      };

      // 1. Setup periodic background polling timer
      const intervalMin = account.syncIntervalMinutes ?? 5;
      if (intervalMin > 0) {
        const intervalMs = intervalMin * 60 * 1000;
        worker.pollingTimer = setInterval(async () => {
          try {
            await this.syncAccount(accountId);
          } catch (pollErr) {
            console.warn(`[Periodic polling error for ${accountId}]:`, pollErr);
          }
        }, intervalMs);
      }

      this.workers.set(accountId, worker);

      // 2. If IDLE is disabled, do not enter persistent IMAP IDLE socket
      if (account.enableIdle === false) {
        // Just run an initial sync
        await this.syncAccount(accountId);
        return;
      }

      await client.connect();

      // Find INBOX folder in DB
      let inboxFolder = await prisma.folder.findFirst({
        where: {
          accountId,
          OR: [{ specialUse: "\\Inbox" }, { path: "INBOX" }],
        },
      });

      if (!inboxFolder) {
        // Initial sync first
        await this.syncAccount(accountId);
        inboxFolder = await prisma.folder.findFirst({
          where: {
            accountId,
            OR: [{ specialUse: "\\Inbox" }, { path: "INBOX" }],
          },
        });
      }

      const inboxPath = inboxFolder?.path || "INBOX";
      const lock = await client.getMailboxLock(inboxPath);

      worker.isIdling = true;

      // Listen for exists (new emails in real-time)
      client.on("exists", async (data) => {
        try {
          // Trigger targeted sync for INBOX
          await this.syncAccount(accountId);
        } catch (exErr) {
          console.error("Error handling exists event:", exErr);
        }
      });

      // Keep IDLE loop running
      (async () => {
        try {
          while (worker.isIdling && !abortController.signal.aborted) {
            await client.idle();
          }
        } catch (idleErr) {
          console.warn(`IDLE loop ended for account ${accountId}:`, idleErr);
        } finally {
          if (lock) {
            try {
              lock.release();
            } catch {}
          }
          this.reconnectWithBackoff(accountId, false);
        }
      })();
    } catch (err: any) {
      const isAuthError =
        Boolean(err?.authenticationFailed) ||
        String(err?.message || "").includes("AUTHENTICATE") ||
        String(err?.message || "").includes("Invalid credentials") ||
        String(err?.message || "").includes("Command failed");
      console.warn(`Failed to start IDLE for account ${accountId}:`, err?.message || err);
      this.reconnectWithBackoff(accountId, isAuthError);
    }
  }

  private reconnectWithBackoff(accountId: string, isAuthError = false) {
    const existing = this.workers.get(accountId);
    if (existing) {
      if (existing.pollingTimer) clearInterval(existing.pollingTimer);
      try {
        existing.client.close();
      } catch {}
      this.workers.delete(accountId);
    }

    // Back off for 5 minutes on authentication error, 30s on transient disconnect
    const delay = isAuthError ? 300000 : 30000;
    setTimeout(() => {
      this.startIdle(accountId).catch(() => {});
    }, delay);
  }

  async stopAccount(accountId: string) {
    const worker = this.workers.get(accountId);
    if (worker) {
      worker.isIdling = false;
      worker.abortController.abort();
      if (worker.retryTimer) clearTimeout(worker.retryTimer);
      if (worker.pollingTimer) clearInterval(worker.pollingTimer);
      try {
        await worker.client.logout();
      } catch {}
      this.workers.delete(accountId);
    }
  }

  async startAllActive() {
    const activeAccounts = await prisma.mailAccount.findMany({
      where: { syncActive: true },
      select: { id: true },
    });

    for (const acc of activeAccounts) {
      this.startIdle(acc.id).catch((err) => {
        console.error(`Could not start idle for account ${acc.id}:`, err);
      });
    }
  }
}

const globalForImap = globalThis as unknown as {
  imapWorkerPool: ImapWorkerPool | undefined;
};

export const imapWorkerPool = globalForImap.imapWorkerPool ?? new ImapWorkerPool();

if (process.env.NODE_ENV !== "production") {
  globalForImap.imapWorkerPool = imapWorkerPool;
}

export default imapWorkerPool;
