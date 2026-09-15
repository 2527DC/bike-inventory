/**
 * The assembly condition level — `enum AssemblyLevel { A50, A85, FULL }` in schema.prisma.
 *
 * One list, so /assembly, /stock and the product details all say the same words. Before plan
 * 1509-assembly-queue-single-bin-and-product-assembly-level these labels lived only inside the
 * Assign modal, and the level had to be chosen for every bicycle. Now it is stored once per
 * product (`Product.assemblyLevel`) and this file is how every screen names it.
 *
 * Safe on both server and client: no imports, no Prisma.
 */

export const ASSEMBLY_LEVEL_VALUES = ["A50", "A85", "FULL"] as const;

export type AssemblyLevelValue = (typeof ASSEMBLY_LEVEL_VALUES)[number];

export const ASSEMBLY_LEVELS: ReadonlyArray<{
  value: AssemblyLevelValue;
  /** "50%" — the short chip text. */
  percent: string;
  /** "Box build" — what the mechanic does. */
  description: string;
}> = [
  { value: "A50", percent: "50%", description: "Box build" },
  { value: "A85", percent: "85%", description: "Semi-built" },
  { value: "FULL", percent: "100%", description: "Full tune" },
];

/** "85% · Semi-built", or "Not set" for a product nobody has decided yet. */
export function assemblyLevelLabel(level: string | null | undefined): string {
  const found = ASSEMBLY_LEVELS.find((l) => l.value === level);
  return found ? `${found.percent} · ${found.description}` : "Not set";
}

export function isAssemblyLevel(value: unknown): value is AssemblyLevelValue {
  return typeof value === "string" && (ASSEMBLY_LEVEL_VALUES as readonly string[]).includes(value);
}
