export interface MessageIdentity {
  id: string;
  accountId: string;
  gmailMessageId?: string | null;
  messageId?: string | null;
  date: string | Date;
}

function identityKeys(message: MessageIdentity): string[] {
  const keys: string[] = [];
  const gmailMessageId = message.gmailMessageId?.trim();
  if (gmailMessageId) {
    keys.push(`${message.accountId}:gmail:${gmailMessageId}`);
  }

  const messageId = message.messageId?.trim();
  if (messageId) keys.push(`${message.accountId}:rfc:${messageId}`);

  return keys;
}

export function isKnownMessageIdentity(
  gmailMessageId: string | null,
  messageId: string | null,
  knownGmailMessageIds: ReadonlySet<string>,
  knownRfcMessageIds: ReadonlySet<string>,
): boolean {
  return Boolean(
    (gmailMessageId && knownGmailMessageIds.has(gmailMessageId)) ||
      (messageId && knownRfcMessageIds.has(messageId)),
  );
}

/**
 * Collapses provider copies of one message while keeping real replies distinct.
 * The explicitly opened row wins so a deep link never gets replaced by a copy
 * from another Gmail label.
 */
export function deduplicateThreadMessages<T extends MessageIdentity>(
  messages: T[],
  preferredMessageId?: string,
): T[] {
  const parent = messages.map((_, index) => index);
  const find = (index: number): number => {
    while (parent[index] !== index) {
      parent[index] = parent[parent[index]];
      index = parent[index];
    }
    return index;
  };
  const union = (left: number, right: number) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parent[rightRoot] = leftRoot;
  };

  const firstIndexByIdentity = new Map<string, number>();
  messages.forEach((message, index) => {
    for (const key of identityKeys(message)) {
      const existingIndex = firstIndexByIdentity.get(key);
      if (existingIndex === undefined) firstIndexByIdentity.set(key, index);
      else union(existingIndex, index);
    }
  });

  const groups = new Map<number, T[]>();
  messages.forEach((message, index) => {
    const groupKey = identityKeys(message).length > 0 ? find(index) : index;
    const group = groups.get(groupKey) || [];
    group.push(message);
    groups.set(groupKey, group);
  });

  return [...groups.values()]
    .map(
      (group) =>
        group.find((message) => message.id === preferredMessageId) || group[0],
    )
    .sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
  );
}
