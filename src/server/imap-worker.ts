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

      // 0. Process any pending actions (moves, deletes, flags) first
      await this.processActionQueue(account.id);

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

            // Get existing messages and Tombstones from DB
            const [existing, tombstones] = await Promise.all([
              prisma.message.findMany({
                where: { folderId },
                select: { id: true, uid: true, isRead: true, isStarred: true },
              }),
              prisma.tombstone.findMany({
                where: { accountId: account.id, folderPath: mbox.path },
                select: { uid: true },
              }),
            ]);
            const existingUidSet = new Set(existing.map((m) => m.uid));
            const tombstoneSet = new Set(tombstones.map((t) => t.uid));

            // Fetch all, seen, and flagged UIDs from mailbox
            const uidsResult = await client.search({ all: true }, { uid: true });
            const remoteUids = Array.isArray(uidsResult) ? (uidsResult as number[]) : [];
            const remoteUidSet = new Set(remoteUids);

            // Fetch seen and flagged UIDs to sync read/unread and starred states from remote
            const [seenResult, flaggedResult] = await Promise.all([
              client.search({ seen: true }, { uid: true }).catch(() => [] as number[]),
              client.search({ flagged: true }, { uid: true }).catch(() => [] as number[]),
            ]);
            const seenUidSet = new Set(Array.isArray(seenResult) ? (seenResult as number[]) : []);
            const flaggedUidSet = new Set(Array.isArray(flaggedResult) ? (flaggedResult as number[]) : []);

            // 1. Sync flag changes for existing messages (e.g. read/starred in another email client)
            for (const msg of existing) {
              if (!remoteUidSet.has(msg.uid)) continue;

              const isSeenRemote = seenUidSet.has(msg.uid);
              const isFlaggedRemote = flaggedUidSet.has(msg.uid);

              if (msg.isRead !== isSeenRemote || msg.isStarred !== isFlaggedRemote) {
                await prisma.message.update({
                  where: { id: msg.id },
                  data: {
                    isRead: isSeenRemote,
                    isStarred: isFlaggedRemote,
                  },
                });

                eventBus.broadcast("message-updated", {
                  accountId: account.id,
                  folderId,
                  id: msg.id,
                  isRead: isSeenRemote,
                  isStarred: isFlaggedRemote,
                });
              }
            }

            // 2. Remove any messages expunged / deleted in another email client
            if (remoteUids.length > 0) {
              const expunged = existing.filter((m) => !remoteUidSet.has(m.uid));
              if (expunged.length > 0) {
                for (const exp of expunged) {
                  try {
                    await prisma.message.delete({ where: { id: exp.id } });
                    eventBus.broadcast("message-deleted", {
                      accountId: account.id,
                      folderId,
                      id: exp.id,
                    });
                  } catch {}
                }
              }
            }

            // 3. Limit to target messages per account setting (default 100)
            const maxLimit = account.syncMaxMessages ?? 100;
            const targetUids = maxLimit > 0 ? remoteUids.slice(-maxLimit) : remoteUids;
            const missingUids = targetUids.filter((uid) => !existingUidSet.has(uid) && !tombstoneSet.has(uid));

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
                  const isRead = seenUidSet.has(uid);
                  const isStarred = flaggedUidSet.has(uid);

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
                      isRead,
                      isStarred,
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
                      isRead: newMessage.isRead,
                      isStarred: newMessage.isStarred,
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

      // Listen for flag updates in real-time (e.g. read/starred in another email client)
      client.on("flags", async (data) => {
        try {
          if (data?.uid && inboxFolder) {
            const isRead = data.flags ? data.flags.has("\\Seen") : false;
            const isStarred = data.flags ? data.flags.has("\\Flagged") : false;

            const existingMsg = await prisma.message.findFirst({
              where: {
                folderId: inboxFolder.id,
                uid: data.uid,
              },
              select: { id: true, isRead: true, isStarred: true },
            });

            if (existingMsg && (existingMsg.isRead !== isRead || existingMsg.isStarred !== isStarred)) {
              await prisma.message.update({
                where: { id: existingMsg.id },
                data: { isRead, isStarred },
              });

              eventBus.broadcast("message-updated", {
                accountId,
                folderId: inboxFolder.id,
                id: existingMsg.id,
                isRead,
                isStarred,
              });

              const unreadCount = await prisma.message.count({
                where: { folderId: inboxFolder.id, isRead: false },
              });
              await prisma.folder.update({
                where: { id: inboxFolder.id },
                data: { unreadCount },
              });
              eventBus.broadcast("folder-updated", { folderId: inboxFolder.id, unreadCount });
            }
          } else {
            // Unsolicited flags without UID or sequence-based: trigger background sync
            this.syncAccount(accountId).catch(() => {});
          }
        } catch (flagsErr) {
          console.error("Error handling flags event in IDLE:", flagsErr);
        }
      });

      // Listen for expunges in real-time (e.g. deleted in another email client)
      client.on("expunge", async (data) => {
        try {
          if (data?.uid && inboxFolder) {
            const existingMsg = await prisma.message.findFirst({
              where: {
                folderId: inboxFolder.id,
                uid: data.uid,
              },
              select: { id: true },
            });

            if (existingMsg) {
              await prisma.message.delete({ where: { id: existingMsg.id } });
              eventBus.broadcast("message-deleted", {
                accountId,
                folderId: inboxFolder.id,
                id: existingMsg.id,
              });

              const [unreadCount, totalCount] = await Promise.all([
                prisma.message.count({ where: { folderId: inboxFolder.id, isRead: false } }),
                prisma.message.count({ where: { folderId: inboxFolder.id } }),
              ]);
              await prisma.folder.update({
                where: { id: inboxFolder.id },
                data: { unreadCount, totalCount },
              });
              eventBus.broadcast("folder-updated", { folderId: inboxFolder.id, unreadCount, totalCount });
            }
          } else {
            // Sequence-based expunge: trigger background sync
            this.syncAccount(accountId).catch(() => {});
          }
        } catch (expErr) {
          console.error("Error handling expunge event in IDLE:", expErr);
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

  /**
   * Processes pending IMAP actions from the persistent queue (delete, move, flags)
   */
  async processActionQueue(targetAccountId?: string) {
    try {
      const pendingActions = await prisma.syncActionQueue.findMany({
        where: {
          status: "pending",
          ...(targetAccountId ? { accountId: targetAccountId } : {}),
        },
        orderBy: { createdAt: "asc" },
        take: 50,
      });

      if (pendingActions.length === 0) return;

      // Group by accountId to reuse client
      const byAccount = new Map<string, typeof pendingActions>();
      for (const item of pendingActions) {
        if (!byAccount.has(item.accountId)) byAccount.set(item.accountId, []);
        byAccount.get(item.accountId)!.push(item);
      }

      for (const [accountId, items] of byAccount.entries()) {
        const account = await prisma.mailAccount.findUnique({
          where: { id: accountId },
        });
        if (!account) continue;

        const client = this.createClient(account);
        try {
          await client.connect();

          for (const item of items) {
            let uids: number[] = [];
            try {
              uids = JSON.parse(item.uids);
            } catch {
              continue;
            }

            if (!Array.isArray(uids) || uids.length === 0) {
              await prisma.syncActionQueue.update({
                where: { id: item.id },
                data: { status: "completed" },
              });
              continue;
            }

            await prisma.syncActionQueue.update({
              where: { id: item.id },
              data: { status: "processing" },
            });

            try {
              const lock = await client.getMailboxLock(item.folderPath);
              try {
                // Filter out any fake/client-only UIDs (>= 1000000)
                const realUids = uids.filter((u) => u < 1000000);

                if (realUids.length > 0) {
                  switch (item.action) {
                    case "delete": {
                      await client.messageDelete(realUids, { uid: true });
                      break;
                    }
                    case "trash":
                    case "archive":
                    case "inbox": {
                      if (item.targetPath && item.targetPath !== item.folderPath) {
                        try {
                          await client.messageMove(realUids, item.targetPath, { uid: true });
                        } catch (moveErr) {
                          // Fallback to copy & delete
                          await client.messageCopy(realUids, item.targetPath, { uid: true });
                          await client.messageDelete(realUids, { uid: true });
                        }
                      } else if (item.action === "trash") {
                        await client.messageDelete(realUids, { uid: true });
                      }
                      break;
                    }
                    case "mark-read": {
                      await client.messageFlagsAdd(realUids, ["\\Seen"], { uid: true });
                      break;
                    }
                    case "mark-unread": {
                      await client.messageFlagsRemove(realUids, ["\\Seen"], { uid: true });
                      break;
                    }
                    case "star": {
                      await client.messageFlagsAdd(realUids, ["\\Flagged"], { uid: true });
                      break;
                    }
                    case "unstar": {
                      await client.messageFlagsRemove(realUids, ["\\Flagged"], { uid: true });
                      break;
                    }
                  }
                }

                await prisma.syncActionQueue.update({
                  where: { id: item.id },
                  data: { status: "completed" },
                });
              } finally {
                lock.release();
              }
            } catch (actionErr: any) {
              console.warn(`[IMAP Action Failed: ${item.action} on ${item.folderPath}]`, actionErr?.message);
              const retries = item.retries + 1;
              await prisma.syncActionQueue.update({
                where: { id: item.id },
                data: {
                  status: retries >= 3 ? "failed" : "pending",
                  retries,
                  error: actionErr?.message || String(actionErr),
                },
              });
            }
          }
        } catch (connErr) {
          console.warn(`[IMAP Action Queue connection failed for ${account.emailAddress}]:`, connErr);
        } finally {
          try {
            await client.logout();
          } catch {}
        }
      }
    } catch (err) {
      console.error("Error processing IMAP action queue:", err);
    }
  }

  /**
   * Helper to queue an IMAP action and immediately trigger processing
   */
  async queueAction(params: {
    accountId: string;
    action: string;
    folderPath: string;
    targetPath?: string | null;
    uids: number[];
  }) {
    // 1. Record Tombstones immediately so sync never re-downloads them
    if (params.action === "delete" || params.action === "trash" || params.action === "archive") {
      const realUids = params.uids.filter((u) => u < 1000000);
      if (realUids.length > 0) {
        await prisma.tombstone.createMany({
          data: realUids.map((uid) => ({
            accountId: params.accountId,
            folderPath: params.folderPath,
            uid,
          })),
          skipDuplicates: true,
        }).catch(() => {});
      }
    }

    // 2. Insert into persistent Queue
    const queued = await prisma.syncActionQueue.create({
      data: {
        accountId: params.accountId,
        action: params.action,
        folderPath: params.folderPath,
        targetPath: params.targetPath || null,
        uids: JSON.stringify(params.uids),
        status: "pending",
      },
    });

    // 3. Trigger processing in background
    this.processActionQueue(params.accountId).catch((err) => {
      console.warn("Background queue processing error:", err);
    });

    return queued;
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
