import { decryptSecret, encryptSecret } from "@/lib/crypto";

export interface ExportedAccount {
  label: string;
  emailAddress: string;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  imapUser: string;
  imapPassword?: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  smtpPassword?: string;
  caldavUrl?: string | null;
  caldavUser?: string | null;
  caldavPassword?: string | null;
  syncActive?: boolean;
  syncIntervalMinutes?: number;
  enableIdle?: boolean;
  syncMaxMessages?: number;
  syncFolderScope?: string;
  caldavSyncIntervalMinutes?: number;
}

export interface ExportedSettings {
  timezoneMode?: string;
  timezone?: string | null;
  trustedSenders?: string[];
}

export interface OmniMailBackupData {
  version: number;
  exportedAt: string;
  app: string;
  accounts: ExportedAccount[];
  settings?: ExportedSettings;
}

export interface ImportCandidate {
  raw: ExportedAccount;
  normalizedEmail: string;
  isExisting: boolean;
  existingId?: string;
}

export interface DeduplicationPlan {
  toCreate: ExportedAccount[];
  toUpdate: { existingId: string; account: ExportedAccount }[];
  toSkip: ExportedAccount[];
  invalid: { item: any; reason: string }[];
  duplicatesAvoided: number;
}

/**
 * Serializes MailAccount DB entities into a JSON-safe export object,
 * decrypting credentials so the exported file contains complete details.
 */
export function serializeAccountsForExport(
  accounts: Array<{
    label: string;
    emailAddress: string;
    imapHost: string;
    imapPort: number;
    imapSecure: boolean;
    imapUser: string;
    imapPassEnc?: string | null;
    smtpHost: string;
    smtpPort: number;
    smtpSecure: boolean;
    smtpUser: string;
    smtpPassEnc?: string | null;
    caldavUrl?: string | null;
    caldavUser?: string | null;
    caldavPassEnc?: string | null;
    syncActive?: boolean;
    syncIntervalMinutes?: number;
    enableIdle?: boolean;
    syncMaxMessages?: number;
    syncFolderScope?: string;
    caldavSyncIntervalMinutes?: number;
  }>,
  userSettings?: ExportedSettings
): OmniMailBackupData {
  const exportedAccounts: ExportedAccount[] = accounts.map((acc) => {
    let imapPassword = "";
    let smtpPassword = "";
    let caldavPassword = "";

    try {
      if (acc.imapPassEnc) imapPassword = decryptSecret(acc.imapPassEnc);
    } catch (e) {
      console.error("Failed to decrypt imap password for export:", acc.emailAddress, e);
    }

    try {
      if (acc.smtpPassEnc) smtpPassword = decryptSecret(acc.smtpPassEnc);
    } catch (e) {
      console.error("Failed to decrypt smtp password for export:", acc.emailAddress, e);
    }

    try {
      if (acc.caldavPassEnc) caldavPassword = decryptSecret(acc.caldavPassEnc);
    } catch (e) {
      console.error("Failed to decrypt caldav password for export:", acc.emailAddress, e);
    }

    return {
      label: acc.label || acc.emailAddress,
      emailAddress: acc.emailAddress,
      imapHost: acc.imapHost,
      imapPort: acc.imapPort ?? 993,
      imapSecure: acc.imapSecure ?? true,
      imapUser: acc.imapUser || acc.emailAddress,
      imapPassword: imapPassword || undefined,
      smtpHost: acc.smtpHost,
      smtpPort: acc.smtpPort ?? 587,
      smtpSecure: acc.smtpSecure ?? false,
      smtpUser: acc.smtpUser || acc.emailAddress,
      smtpPassword: smtpPassword || undefined,
      caldavUrl: acc.caldavUrl || null,
      caldavUser: acc.caldavUser || null,
      caldavPassword: caldavPassword || undefined,
      syncActive: acc.syncActive ?? true,
      syncIntervalMinutes: acc.syncIntervalMinutes ?? 5,
      enableIdle: acc.enableIdle ?? true,
      syncMaxMessages: acc.syncMaxMessages ?? 100,
      syncFolderScope: acc.syncFolderScope ?? "all",
      caldavSyncIntervalMinutes: acc.caldavSyncIntervalMinutes ?? 15,
    };
  });

  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    app: "OmniMail",
    accounts: exportedAccounts,
    ...(userSettings ? { settings: userSettings } : {}),
  };
}

/**
 * Normalizes input from various JSON structures (array, { accounts: [] }, { mailAccounts: [] }).
 */
export function parseBackupPayload(data: unknown): {
  accounts: ExportedAccount[];
  settings?: ExportedSettings;
} {
  if (!data || typeof data !== "object") {
    throw new Error("Invalid import payload: expected an object or array");
  }

  let rawList: any[] = [];
  let settings: ExportedSettings | undefined;

  if (Array.isArray(data)) {
    rawList = data;
  } else {
    const obj = data as Record<string, any>;
    if (Array.isArray(obj.accounts)) {
      rawList = obj.accounts;
    } else if (Array.isArray(obj.mailAccounts)) {
      rawList = obj.mailAccounts;
    } else {
      throw new Error("Invalid import payload: missing 'accounts' array");
    }

    if (obj.settings && typeof obj.settings === "object") {
      settings = {
        timezoneMode: typeof obj.settings.timezoneMode === "string" ? obj.settings.timezoneMode : undefined,
        timezone: typeof obj.settings.timezone === "string" ? obj.settings.timezone : undefined,
        trustedSenders: Array.isArray(obj.settings.trustedSenders)
          ? obj.settings.trustedSenders.filter((s: unknown) => typeof s === "string" && s.includes("@"))
          : undefined,
      };
    }
  }

  const normalizedAccounts: ExportedAccount[] = rawList.map((item) => {
    const email = String(item.emailAddress || item.email || "").trim();
    const imapPass = item.imapPassword || item.password || item.pass || "";
    const smtpPass = item.smtpPassword || item.password || item.pass || "";
    const calPass = item.caldavPassword || item.caldavPass || item.password || "";

    return {
      label: String(item.label || email).trim(),
      emailAddress: email,
      imapHost: String(item.imapHost || "").trim(),
      imapPort: Number(item.imapPort) || 993,
      imapSecure: item.imapSecure !== undefined ? Boolean(item.imapSecure) : true,
      imapUser: String(item.imapUser || email).trim(),
      imapPassword: imapPass ? String(imapPass) : undefined,
      smtpHost: String(item.smtpHost || "").trim(),
      smtpPort: Number(item.smtpPort) || 587,
      smtpSecure: item.smtpSecure !== undefined ? Boolean(item.smtpSecure) : false,
      smtpUser: String(item.smtpUser || email).trim(),
      smtpPassword: smtpPass ? String(smtpPass) : undefined,
      caldavUrl: item.caldavUrl ? String(item.caldavUrl).trim() : null,
      caldavUser: item.caldavUser ? String(item.caldavUser).trim() : null,
      caldavPassword: calPass ? String(calPass) : undefined,
      syncActive: item.syncActive !== undefined ? Boolean(item.syncActive) : true,
      syncIntervalMinutes: Number(item.syncIntervalMinutes) || 5,
      enableIdle: item.enableIdle !== undefined ? Boolean(item.enableIdle) : true,
      syncMaxMessages: Number(item.syncMaxMessages) || 100,
      syncFolderScope: item.syncFolderScope ? String(item.syncFolderScope) : "all",
      caldavSyncIntervalMinutes: Number(item.caldavSyncIntervalMinutes) || 15,
    };
  });

  return { accounts: normalizedAccounts, settings };
}

/**
 * Deduplicates accounts against existing database accounts and internal file entries.
 * Avoids creating duplicate records with the same emailAddress.
 */
export function planAccountDeduplication(
  importedAccounts: ExportedAccount[],
  existingAccounts: Array<{ id: string; emailAddress: string }>,
  options: { updateExisting?: boolean } = {}
): DeduplicationPlan {
  const updateExisting = options.updateExisting ?? true;
  const existingMap = new Map<string, string>();
  for (const acc of existingAccounts) {
    if (acc.emailAddress) {
      existingMap.set(acc.emailAddress.toLowerCase().trim(), acc.id);
    }
  }

  const seenInImport = new Set<string>();
  const toCreate: ExportedAccount[] = [];
  const toUpdate: { existingId: string; account: ExportedAccount }[] = [];
  const toSkip: ExportedAccount[] = [];
  const invalid: { item: any; reason: string }[] = [];
  let duplicatesAvoided = 0;

  for (const acc of importedAccounts) {
    const rawEmail = acc.emailAddress;
    if (!rawEmail || !rawEmail.includes("@")) {
      invalid.push({ item: acc, reason: "Missing or invalid email address" });
      continue;
    }

    const normEmail = rawEmail.toLowerCase().trim();

    // Check if this email was already processed earlier in this exact import payload
    if (seenInImport.has(normEmail)) {
      duplicatesAvoided++;
      toSkip.push(acc);
      continue;
    }
    seenInImport.add(normEmail);

    const existingId = existingMap.get(normEmail);
    if (existingId) {
      duplicatesAvoided++;
      if (updateExisting) {
        toUpdate.push({ existingId, account: acc });
      } else {
        toSkip.push(acc);
      }
    } else {
      toCreate.push(acc);
      // Track as existing within the plan so further matches in this import are treated as duplicates
      existingMap.set(normEmail, "pending-creation");
    }
  }

  return {
    toCreate,
    toUpdate,
    toSkip,
    invalid,
    duplicatesAvoided,
  };
}
