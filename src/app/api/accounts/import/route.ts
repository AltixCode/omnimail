import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/db";
import { encryptSecret } from "@/lib/crypto";
import { getOrCreateDefaultUser } from "@/lib/user";
import imapWorkerPool from "@/server/imap-worker";
import caldavWorker from "@/server/caldav-worker";
import { parseBackupPayload, planAccountDeduplication } from "@/lib/account-backup";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const user = await getOrCreateDefaultUser(req);
    const body = await req.json();

    const updateExisting = body?.updateExisting !== false; // default true to update rather than duplicate
    const { accounts: parsedAccounts, settings } = parseBackupPayload(body);

    if (parsedAccounts.length === 0) {
      return NextResponse.json(
        { error: "No valid accounts found in the provided import JSON." },
        { status: 400 }
      );
    }

    const existingAccounts = await prisma.mailAccount.findMany({
      where: { userId: user.id },
      select: { id: true, emailAddress: true },
    });

    const plan = planAccountDeduplication(parsedAccounts, existingAccounts, { updateExisting });

    let createdCount = 0;
    let updatedCount = 0;
    let skippedCount = plan.toSkip.length;
    const errors: Array<{ email: string; error: string }> = plan.invalid.map((inv) => ({
      email: inv.item?.emailAddress || "unknown",
      error: inv.reason,
    }));

    // 1. Process Updates (avoid duplicates by modifying existing account)
    for (const item of plan.toUpdate) {
      try {
        const acc = item.account;
        const dataToUpdate: Record<string, any> = {
          label: acc.label || acc.emailAddress,
          emailAddress: acc.emailAddress,
          imapHost: acc.imapHost,
          imapPort: Number(acc.imapPort) || 993,
          imapSecure: Boolean(acc.imapSecure),
          imapUser: acc.imapUser || acc.emailAddress,
          smtpHost: acc.smtpHost,
          smtpPort: Number(acc.smtpPort) || 587,
          smtpSecure: Boolean(acc.smtpSecure),
          smtpUser: acc.smtpUser || acc.emailAddress,
          syncActive: acc.syncActive ?? true,
          syncIntervalMinutes: Number(acc.syncIntervalMinutes) || 5,
          enableIdle: acc.enableIdle ?? true,
          syncMaxMessages: Number(acc.syncMaxMessages) || 100,
          syncFolderScope: String(acc.syncFolderScope || "all"),
          caldavSyncIntervalMinutes: Number(acc.caldavSyncIntervalMinutes) || 15,
          syncStatus: "idle",
          lastError: null,
        };

        if (acc.imapPassword) {
          dataToUpdate.imapPassEnc = encryptSecret(acc.imapPassword);
        }
        if (acc.smtpPassword) {
          dataToUpdate.smtpPassEnc = encryptSecret(acc.smtpPassword);
        }

        if (acc.caldavUrl !== undefined) {
          dataToUpdate.caldavUrl = acc.caldavUrl ? String(acc.caldavUrl).trim() : null;
        }
        if (acc.caldavUser !== undefined) {
          dataToUpdate.caldavUser = acc.caldavUser ? String(acc.caldavUser).trim() : null;
        }
        if (acc.caldavPassword) {
          dataToUpdate.caldavPassEnc = encryptSecret(acc.caldavPassword);
        }

        await prisma.mailAccount.update({
          where: { id: item.existingId },
          data: dataToUpdate,
        });

        updatedCount++;

        // Restart worker in background
        imapWorkerPool.stopAccount(item.existingId).then(() => {
          if (dataToUpdate.syncActive) {
            setTimeout(async () => {
              try {
                await imapWorkerPool.syncAccount(item.existingId);
                await imapWorkerPool.startIdle(item.existingId);
                if (dataToUpdate.caldavUrl) {
                  await caldavWorker.syncAccount(item.existingId);
                }
              } catch (err) {
                console.error("Worker sync failed after account import update:", err);
              }
            }, 100);
          }
        }).catch(() => {});
      } catch (err: any) {
        errors.push({
          email: item.account.emailAddress,
          error: `Failed to update existing account: ${err.message}`,
        });
      }
    }

    // 2. Process New Accounts (Create)
    for (const acc of plan.toCreate) {
      try {
        if (!acc.emailAddress || !acc.imapHost || !acc.smtpHost) {
          errors.push({
            email: acc.emailAddress,
            error: "Missing required IMAP or SMTP server host",
          });
          continue;
        }

        if (!acc.imapPassword || !acc.smtpPassword) {
          errors.push({
            email: acc.emailAddress,
            error: "Account credentials (IMAP or SMTP password) missing in import JSON",
          });
          continue;
        }

        const imapPassEnc = encryptSecret(acc.imapPassword);
        const smtpPassEnc = encryptSecret(acc.smtpPassword);

        let finalCaldavUrl = acc.caldavUrl ? acc.caldavUrl.trim() : null;
        const emailLower = acc.emailAddress.toLowerCase();
        const imapHostLower = acc.imapHost.toLowerCase();

        // Autoconfigure CalDAV URL heuristic if not supplied
        if (!finalCaldavUrl) {
          if (emailLower.endsWith("@purelymail.com") || imapHostLower.includes("purelymail")) {
            finalCaldavUrl = "https://purelymail.com/dav/";
          } else if (emailLower.endsWith("@icloud.com") || emailLower.endsWith("@me.com") || emailLower.endsWith("@mac.com") || imapHostLower.includes("mail.me.com")) {
            finalCaldavUrl = "https://caldav.icloud.com/";
          } else if (emailLower.endsWith("@fastmail.com") || emailLower.endsWith("@fastmail.fm") || imapHostLower.includes("fastmail")) {
            finalCaldavUrl = "https://caldav.fastmail.com/dav/";
          } else if (emailLower.endsWith("@zoho.com") || emailLower.endsWith("@zoho.eu") || imapHostLower.includes("zoho")) {
            finalCaldavUrl = emailLower.endsWith(".eu") ? "https://calendar.zoho.eu/" : "https://calendar.zoho.com/";
          } else if (emailLower.endsWith("@mailbox.org") || imapHostLower.includes("mailbox.org")) {
            finalCaldavUrl = "https://dav.mailbox.org/caldav/";
          } else if (emailLower.endsWith("@posteo.de") || emailLower.endsWith("@posteo.net") || imapHostLower.includes("posteo")) {
            finalCaldavUrl = "https://posteo.de:8443/";
          }
        }

        const finalCaldavUser = acc.caldavUser || (finalCaldavUrl ? (acc.imapUser || acc.emailAddress) : null);
        const finalCaldavPassEnc = acc.caldavPassword
          ? encryptSecret(acc.caldavPassword)
          : (finalCaldavUrl ? imapPassEnc : null);

        const newAccount = await prisma.mailAccount.create({
          data: {
            userId: user.id,
            label: acc.label || acc.emailAddress,
            emailAddress: acc.emailAddress,
            imapHost: acc.imapHost,
            imapPort: Number(acc.imapPort) || 993,
            imapSecure: Boolean(acc.imapSecure),
            imapUser: acc.imapUser || acc.emailAddress,
            imapPassEnc,
            smtpHost: acc.smtpHost,
            smtpPort: Number(acc.smtpPort) || 587,
            smtpSecure: Boolean(acc.smtpSecure),
            smtpUser: acc.smtpUser || acc.emailAddress,
            smtpPassEnc,
            caldavUrl: finalCaldavUrl,
            caldavUser: finalCaldavUser,
            caldavPassEnc: finalCaldavPassEnc,
            syncActive: acc.syncActive ?? true,
            syncIntervalMinutes: Number(acc.syncIntervalMinutes) || 5,
            enableIdle: acc.enableIdle ?? true,
            syncMaxMessages: Number(acc.syncMaxMessages) || 100,
            syncFolderScope: String(acc.syncFolderScope || "all"),
            caldavSyncIntervalMinutes: Number(acc.caldavSyncIntervalMinutes) || 15,
          },
        });

        createdCount++;

        // Trigger background initial sync & IDLE
        setTimeout(async () => {
          try {
            await imapWorkerPool.syncAccount(newAccount.id);
            await imapWorkerPool.startIdle(newAccount.id);
            if (newAccount.caldavUrl) {
              await caldavWorker.syncAccount(newAccount.id);
            }
          } catch (syncErr) {
            console.error("Worker initial sync failed after account import:", syncErr);
          }
        }, 100);
      } catch (err: any) {
        errors.push({
          email: acc.emailAddress,
          error: `Failed to create account: ${err.message}`,
        });
      }
    }

    // 3. Process Settings if provided
    if (settings) {
      try {
        const userUpdates: Record<string, any> = {};
        if (settings.timezoneMode === "automatic" || settings.timezoneMode === "manual") {
          userUpdates.timezoneMode = settings.timezoneMode;
        }
        if (typeof settings.timezone === "string") {
          userUpdates.timezone = settings.timezone;
        }

        if (Object.keys(userUpdates).length > 0) {
          await prisma.user.update({
            where: { id: user.id },
            data: userUpdates,
          });
        }

        if (Array.isArray(settings.trustedSenders)) {
          for (const email of settings.trustedSenders) {
            if (typeof email === "string" && email.includes("@")) {
              await prisma.trustedSender.upsert({
                where: {
                  userId_email: {
                    userId: user.id,
                    email: email.toLowerCase().trim(),
                  },
                },
                create: {
                  userId: user.id,
                  email: email.toLowerCase().trim(),
                },
                update: {},
              });
            }
          }
        }
      } catch (settingsErr) {
        console.error("Failed to import user settings:", settingsErr);
      }
    }

    return NextResponse.json({
      success: true,
      summary: {
        total: parsedAccounts.length,
        created: createdCount,
        updated: updatedCount,
        skipped: skippedCount,
        duplicatesAvoided: plan.duplicatesAvoided,
        errors,
      },
    });
  } catch (error: any) {
    console.error("Failed to import accounts:", error);
    return NextResponse.json(
      { error: error.message || "Failed to import accounts" },
      { status: 500 }
    );
  }
}
