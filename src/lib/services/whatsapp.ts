// WhatsApp message templates per status
const TEMPLATES: Record<string, (name: string, token: string, extra?: { amount?: number | null; items?: string | null }) => string> = {
  PARTS_NEEDED: (name, token, extra) => {
    let msg = `Hi ${name}! 🔧 Your bike (${token}) needs some parts.`;
    if (extra?.items) {
      msg += `\n\n📋 *Breakdown:*\n${extra.items}`;
    }
    if (extra?.amount != null && extra.amount > 0) {
      msg += `\n\n💰 *Updated Total: ₹${extra.amount.toLocaleString("en-IN")}*`;
    }
    msg += `\n\nWe'll update you once parts are ready. — Bharath Cycle Hub`;
    return msg;
  },
  READY: (name, token) =>
    `Hi ${name}! ✅ Your bike (${token}) is ready for pickup!\n\nPlease collect it within *3 working days*.\n\n⚠️ _After 3 days, your bike will be moved to our warehouse for space management. Retrieval from warehouse will incur additional charges._\n\n— Bharath Cycle Hub`,
  DELIVERED: (name, token) =>
    `Hi ${name}! 🏁 Thank you for choosing Bharath Cycle Hub! Your bike (${token}) has been delivered. Ride safe! 🚲`,
};

// First message sent at inward — includes cost breakdown
export function getInwardWhatsAppUrl(
  phone: string,
  customerName: string,
  tokenNumber: string,
  jobTypeLabel: string,
  amount: number | null,
  items?: string | null,
  promisedDate?: string | null,
): string | null {
  const cleanPhone = phone.replace(/\D/g, "");
  if (!cleanPhone || cleanPhone === "0000000000") return null;

  let msg = `Hi ${customerName}! 🚲 Your bike has been received at *Bharath Cycle Hub*.\n\nToken: *${tokenNumber}*\nService: ${jobTypeLabel}`;
  if (items) {
    msg += `\n\n📋 *Breakdown:*\n${items}`;
  }
  if (amount != null && amount > 0) {
    msg += `\n\n💰 *Total Due: ₹${amount.toLocaleString("en-IN")}*`;
  }
  if (promisedDate) {
    const d = new Date(promisedDate);
    const dateStr = d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", weekday: "short", timeZone: "Asia/Kolkata" });
    msg += `\n\n📅 *Expected Delivery: ${dateStr}*`;
  }
  msg += `\n\nWe will update you once it's ready. Thank you!`;
  return `https://wa.me/91${cleanPhone}?text=${encodeURIComponent(msg)}`;
}

// Pickup reminder for bikes sitting READY 3+ days
export function getPickupReminderUrl(
  phone: string,
  customerName: string,
  tokenNumber: string,
  daysSinceReady: number,
  readyBikeCount: number,
): string | null {
  const cleanPhone = phone.replace(/\D/g, "");
  if (!cleanPhone || cleanPhone === "0000000000") return null;

  let msg = `Hi ${customerName}! 📢 Your bike (${tokenNumber}) has been ready for *${daysSinceReady} days* now and is awaiting pickup.\n\n`;
  msg += `⚠️ *Important:* We currently have *${readyBikeCount}+ bikes* waiting for pickup. Due to space constraints, bikes not collected within 3 working days will be *transferred to our warehouse*.\n\n`;
  msg += `🏪 Warehouse retrieval will incur additional charges.\n\n`;
  msg += `Please collect your bike at the earliest. Thank you!\n\n— Bharath Cycle Hub`;

  return `https://wa.me/91${cleanPhone}?text=${encodeURIComponent(msg)}`;
}

export function getWhatsAppUrl(
  phone: string,
  status: string,
  customerName: string,
  tokenNumber: string,
  extra?: { amount?: number | null; items?: string | null },
): string | null {
  const template = TEMPLATES[status];
  if (!template) return null;

  // Skip WhatsApp for walk-in customers with no real phone
  const cleanPhone = phone.replace(/\D/g, "");
  if (!cleanPhone || cleanPhone === "0000000000") return null;

  const msg = template(customerName, tokenNumber, extra);
  return `https://wa.me/91${cleanPhone}?text=${encodeURIComponent(msg)}`;
}
