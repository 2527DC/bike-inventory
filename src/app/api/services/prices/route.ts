import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { serviceGuard } from "@/lib/services/guard";

// GET — fetch all price items (any logged-in user)
export async function GET() {
  const prices = await prisma.priceItem.findMany({
    where: { active: true },
    orderBy: [{ category: "asc" }, { name: "asc" }],
  });

  return NextResponse.json({ prices });
}

// POST — create or update a price item. Authorised by `service_prices.create`.
//
// A second gate used to sit on top of serviceGuard here:
//
//     if (!user || !["MANAGER", "STAFF", "BILLING", "SUPERVISOR"].includes(user.roleName))
//
// It compared role NAMES against what are actually role KEYS. `roleName` is `Role.name` —
// "Service Manager", "Administrator" — so NONE of the eight roles matched and this route
// returned 403 to everyone, ADMIN included. Nobody could add or edit a workshop price.
//
// Deleted rather than translated to keys: line below already asked the only question that
// matters, and `service_prices.create` is held by ADMIN and SERVICE_MANAGER. Re-expressing
// the same rule as a name list is what CLAUDE.md bans — roles are rows an admin can create
// at runtime, so no list in code can stay correct. DELETE below was always written this way.
export async function POST(req: NextRequest) {
  const { error: authError } = await serviceGuard("service_prices", "create");
  if (authError) return authError;

  const { id, name, category, price, wheelSize } = await req.json();

  if (!name || !category || price === undefined || price === null) {
    return NextResponse.json({ error: "Name, category, and price required" }, { status: 400 });
  }

  if (!["SERVICE", "PARTS"].includes(category)) {
    return NextResponse.json({ error: "Category must be SERVICE or PARTS" }, { status: 400 });
  }

  if (typeof price !== "number" || price < 0) {
    return NextResponse.json({ error: "Price must be a positive number" }, { status: 400 });
  }

  const data = { name, category, price, wheelSize: wheelSize || null };

  if (id) {
    const updated = await prisma.priceItem.update({ where: { id }, data });
    return NextResponse.json({ price: updated });
  }

  // Check for duplicate (same name, category, wheelSize)
  const existing = await prisma.priceItem.findFirst({
    where: {
      name: { equals: name, mode: "insensitive" },
      category,
      wheelSize: wheelSize || null,
      active: true,
    },
  });
  if (existing) {
    return NextResponse.json(
      { error: `"${name}" already exists in ${category}${wheelSize ? ` (${wheelSize})` : ""}` },
      { status: 400 }
    );
  }

  const created = await prisma.priceItem.create({ data });

  return NextResponse.json({ price: created });
}

// DELETE — soft-delete a price item (MANAGER only)
export async function DELETE(req: NextRequest) {
  const { error: authError } = await serviceGuard("service_prices", "delete");
  if (authError) return authError;

  const { id } = await req.json();
  if (!id) {
    return NextResponse.json({ error: "ID required" }, { status: 400 });
  }

  await prisma.priceItem.update({
    where: { id },
    data: { active: false },
  });

  return NextResponse.json({ success: true });
}
