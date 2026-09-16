import type { Prisma } from "@prisma/client";

/**
 * The delivery slot calendar — 10 deliveries a day, 13:00 IST same-day cutoff, 14 days ahead.
 *
 * Lifted out of `api/public/delivery-slots/route.ts` (plan 1609-deliveries, T9) so the three
 * places that decide "is this day full?" — the customer's calendar, the customer's submit and
 * the staff date editor — count the same way.
 *
 * A day's count is every delivery whose `scheduledDate` falls on it, except PREBOOKED and
 * WALK_OUT — the rule the public route has always used.
 */

export const MAX_SLOTS_PER_DAY = 10;
export const CUTOFF_HOUR_IST = 13;
export const LOOKAHEAD_DAYS = 14;

type Client = { delivery: Prisma.TransactionClient["delivery"] };

export interface SlotDay {
  date: string;
  available: boolean;
  spotsLeft: number;
  reason: "FULL" | "CUTOFF" | "PAST" | null;
  booked: number;
}

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** "YYYY-MM-DD" of a moment, in IST. */
export function toISTDateString(date: Date): string {
  return new Date(date.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** Start and end of an IST calendar day ("YYYY-MM-DD"). */
export function istDayBounds(dateStr: string): { start: Date; end: Date } {
  return { start: new Date(`${dateStr}T00:00:00+05:30`), end: new Date(`${dateStr}T23:59:59+05:30`) };
}

export function isDateString(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

/** How many deliveries hold a slot on this IST day, optionally not counting one delivery. */
export async function countBookedOn(client: Client, dateStr: string, excludeId?: string): Promise<number> {
  const { start, end } = istDayBounds(dateStr);
  return client.delivery.count({
    where: {
      scheduledDate: { gte: start, lte: end },
      status: { notIn: ["PREBOOKED", "WALK_OUT"] },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
  });
}

/**
 * Why a day cannot be booked right now, or null when it can. `excludeId` lets a delivery keep
 * (or re-pick) its own day without counting itself.
 */
export async function slotRefusal(
  client: Client,
  dateStr: string,
  excludeId?: string,
  now: Date = new Date()
): Promise<"PAST" | "CUTOFF" | "FULL" | null> {
  const today = toISTDateString(now);
  if (dateStr < today) return "PAST";
  if (dateStr === today && new Date(now.getTime() + IST_OFFSET_MS).getUTCHours() >= CUTOFF_HOUR_IST) return "CUTOFF";
  const booked = await countBookedOn(client, dateStr, excludeId);
  return booked >= MAX_SLOTS_PER_DAY ? "FULL" : null;
}

export const SLOT_REFUSAL_MESSAGE: Record<"PAST" | "CUTOFF" | "FULL", string> = {
  PAST: "That date has already passed. Please choose another date.",
  CUTOFF: "Same-day delivery closes at 1 PM. Please choose another date.",
  FULL: "This delivery slot is now full. Please choose another date.",
};

/** The next LOOKAHEAD_DAYS days with availability. */
export async function buildSlotCalendar(
  client: Client,
  now: Date = new Date()
): Promise<{ slots: SlotDay[]; nextAvailable: string | null }> {
  const todayIST = toISTDateString(now);
  const hourIST = new Date(now.getTime() + IST_OFFSET_MS).getUTCHours();

  const dates: string[] = [];
  for (let i = 0; i < LOOKAHEAD_DAYS; i++) {
    const d = new Date(now.getTime() + IST_OFFSET_MS);
    d.setUTCDate(d.getUTCDate() + i);
    dates.push(d.toISOString().slice(0, 10));
  }

  const rows = await client.delivery.groupBy({
    by: ["scheduledDate"],
    where: {
      scheduledDate: { gte: istDayBounds(dates[0]).start, lte: istDayBounds(dates[dates.length - 1]).end },
      status: { notIn: ["PREBOOKED", "WALK_OUT"] },
    },
    _count: { scheduledDate: true },
  });

  const countMap: Record<string, number> = {};
  for (const row of rows) {
    if (!row.scheduledDate) continue;
    const key = toISTDateString(row.scheduledDate);
    countMap[key] = (countMap[key] || 0) + (row._count.scheduledDate ?? 0);
  }

  const slots: SlotDay[] = dates.map((date) => {
    const booked = countMap[date] || 0;
    const spotsLeft = Math.max(0, MAX_SLOTS_PER_DAY - booked);
    let reason: SlotDay["reason"] = null;
    if (date < todayIST) reason = "PAST";
    else if (date === todayIST && hourIST >= CUTOFF_HOUR_IST) reason = "CUTOFF";
    else if (spotsLeft === 0) reason = "FULL";
    return { date, available: reason === null, spotsLeft, reason, booked };
  });

  return { slots, nextAvailable: slots.find((s) => s.available)?.date ?? null };
}
