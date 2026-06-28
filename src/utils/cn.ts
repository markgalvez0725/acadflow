type ClassValue = string | number | boolean | null | undefined | ClassValue[];

/**
 * Merges class names with conditional logic (clsx-style: strings, numbers,
 * arrays, and falsy values are handled; falsy entries are dropped).
 *
 * Self-contained on purpose - the app ships no `clsx` / `tailwind-merge`
 * dependency (and the lockfile is fixed), so this stays dependency-free.
 * Styling here is CSS-variable / BEM-ish class based, not heavy Tailwind
 * utility composition, so utility-conflict de-duplication isn't needed.
 */
export function cn(...inputs: ClassValue[]): string {
  const out: string[] = [];
  for (const input of inputs) {
    if (!input) continue;
    if (typeof input === 'string' || typeof input === 'number') {
      out.push(String(input));
    } else if (Array.isArray(input)) {
      const inner = cn(...input);
      if (inner) out.push(inner);
    }
  }
  return out.join(' ');
}
