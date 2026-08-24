// Job status config
export const JOB_STATUS = {
  RECEIVED: { emoji: "📥", label: "Pending", color: "bg-blue-500", textColor: "text-blue-700", bgLight: "bg-blue-50", hex: "#3b82f6" },
  PARTS_NEEDED: { emoji: "⏸️", label: "Hold", color: "bg-orange-500", textColor: "text-orange-700", bgLight: "bg-orange-50", hex: "#f97316" },
  READY: { emoji: "✅", label: "Ready", color: "bg-green-500", textColor: "text-green-700", bgLight: "bg-green-50", hex: "#22c55e" },
  DELIVERED: { emoji: "🏁", label: "Delivered", color: "bg-gray-400", textColor: "text-gray-700", bgLight: "bg-gray-50", hex: "#9ca3af" },
} as const;

// Job type config — amount in ₹ (0 = free, null = variable/enter manually)
export const JOB_TYPE = {
  QFX:  { emoji: "⚡", label: "Quick Fix",          amount: 99,   variable: false },
  RSVC: { emoji: "🛠️", label: "Repair & Service",   amount: null, variable: true },
  FSVC: { emoji: "🆓", label: "Free Service",       amount: 0,    variable: false },
  SND:  { emoji: "♻️", label: "2nd Hand Repair",     amount: null, variable: true },
  WSH:  { emoji: "🫧", label: "Wash",               amount: 99,   variable: false },
  ECYC: { emoji: "🔋", label: "E-Cycle Service",    amount: null, variable: true },
} as const;

// Status flow — what can transition to what
export const STATUS_FLOW: Record<string, string[]> = {
  RECEIVED: ["PARTS_NEEDED", "READY"],
  PARTS_NEEDED: ["RECEIVED", "READY", "PARTS_NEEDED"],
  READY: ["DELIVERED", "RECEIVED"],
  DELIVERED: [],
};

// Bike categories — maps wheel sizes to meaningful labels
export const BIKE_CATEGORIES: Record<string, { label: string; emoji: string; sizes: string[] }> = {
  KIDS: { label: "Kids", emoji: "🧒", sizes: ["14", "20"] },
  ADULTS: { label: "Adults", emoji: "🚲", sizes: ["24", "26"] },
  GEARED: { label: "Geared", emoji: "⚙️", sizes: ["27.5"] },
  PREMIUM: { label: "Premium", emoji: "🏆", sizes: ["29"] },
  ECYCLE: { label: "E-Cycle", emoji: "🔋", sizes: ["ECYCLE"] },
};

// Map a wheelSize value to its category label
export function getBikeCategory(wheelSize: string | null): string {
  if (!wheelSize) return "Universal";
  for (const cat of Object.values(BIKE_CATEGORIES)) {
    if (cat.sizes.includes(wheelSize)) return cat.label;
  }
  return wheelSize;
}

// Mechanic roster (seeded in DB, here for reference)
export const MECHANICS = [
  { name: "Appi", emoji: "🔥", role: "MECHANIC" },
  { name: "Sanjay", emoji: "🫧", role: "MECHANIC" },
  { name: "Baba", emoji: "💪", role: "MECHANIC" },
  { name: "Mohan", emoji: "📦", role: "MECHANIC" },
  { name: "Iqbal", emoji: "🚚", role: "MECHANIC" },
  { name: "Mujju", emoji: "⚙️", role: "MECHANIC" },
  { name: "Shravan", emoji: "👨‍💼", role: "SUPERVISOR" },
  { name: "Ibrahim", emoji: "👑", role: "MANAGER" },
] as const;
