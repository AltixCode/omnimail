/**
 * Distinct vibrant color palette for multi-calendar differentiation
 */
export const CALENDAR_PALETTE = [
  "#2563eb", // Royal Blue (Google / primary)
  "#059669", // Emerald Green (Work)
  "#7c3aed", // Vivid Purple (Personal / Consulting)
  "#d97706", // Warm Amber (Fastmail)
  "#db2777", // Rose / Pink (AltixCode)
  "#0891b2", // Cyan / Teal (HushTunnel)
  "#ea580c", // Deep Orange
  "#4f46e5", // Indigo
  "#16a34a", // Forest Green
  "#dc2626", // Crimson Red
  "#9333ea", // Violet
  "#0284c7", // Sky Blue
];

/**
 * Returns a distinct color based on index or hash
 */
export function getDifferentiatedColor(index: number, existingUsedColors: Set<string> = new Set()): string {
  for (const color of CALENDAR_PALETTE) {
    if (!existingUsedColors.has(color)) {
      return color;
    }
  }
  return CALENDAR_PALETTE[index % CALENDAR_PALETTE.length];
}
