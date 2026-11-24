export interface AnchorCandidate {
  id: string;
  offsetTop: number;
}

export interface ScrollAnchorSnapshot {
  candidates: AnchorCandidate[];
}

export const TOP_SCROLL_THRESHOLD = 5;

/**
 * Captures the first visible message elements inside `container` relative to
 * the container's top edge. Returns `null` when the list is at the very top
 * (within `TOP_SCROLL_THRESHOLD`) so newly arriving emails appear naturally at
 * the top without pushing the user down.
 */
export function captureScrollAnchor(
  container: HTMLElement | null,
  maxCandidates = 20,
): ScrollAnchorSnapshot | null {
  if (!container || container.scrollTop <= TOP_SCROLL_THRESHOLD) {
    return null;
  }

  const containerTop = container.getBoundingClientRect().top;
  const elements = container.querySelectorAll<HTMLElement>("[data-message-id]");
  const candidates: AnchorCandidate[] = [];

  for (const el of elements) {
    const id = el.dataset.messageId;
    if (!id) continue;
    const rect = el.getBoundingClientRect();
    if (rect.bottom > containerTop) {
      candidates.push({
        id,
        offsetTop: rect.top - containerTop,
      });
      if (candidates.length >= maxCandidates) {
        break;
      }
    }
  }

  return candidates.length > 0 ? { candidates } : null;
}

/**
 * Computes the `scrollTop` delta needed to keep the anchored message(s) in
 * place after a list mutation. Returns `null` if no captured candidate remains
 * in the list.
 */
export function computeAnchorDelta(
  snapshot: ScrollAnchorSnapshot,
  newOffsetTopById: Map<string, number>,
): number | null {
  const firstCandidate = snapshot.candidates[0];
  if (!firstCandidate) return null;

  for (let i = 0; i < snapshot.candidates.length; i++) {
    const candidate = snapshot.candidates[i];
    const newOffsetTop = newOffsetTopById.get(candidate.id);
    if (newOffsetTop === undefined) continue;

    // If the topmost visible email survived, pin it to its exact pixel.
    // If it was deleted, align the next surviving email cleanly where it was,
    // clamped to >= 0 so partially scrolled-off headers don't pull above top.
    const targetOffsetTop =
      i === 0 ? firstCandidate.offsetTop : Math.max(0, firstCandidate.offsetTop);

    const delta = newOffsetTop - targetOffsetTop;
    return Math.abs(delta) < 0.5 ? 0 : delta;
  }

  return null;
}

/**
 * Measures current positions of `[data-message-id]` elements inside
 * `container` and returns the `scrollTop` delta from `snapshot`.
 */
export function computeScrollAdjustment(
  container: HTMLElement | null,
  snapshot: ScrollAnchorSnapshot,
): number | null {
  if (!container) return null;

  const containerTop = container.getBoundingClientRect().top;
  const elements = container.querySelectorAll<HTMLElement>("[data-message-id]");
  const newOffsetTopById = new Map<string, number>();

  for (const el of elements) {
    const id = el.dataset.messageId;
    if (!id) continue;
    newOffsetTopById.set(id, el.getBoundingClientRect().top - containerTop);
  }

  return computeAnchorDelta(snapshot, newOffsetTopById);
}
