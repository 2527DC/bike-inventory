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

// POST — create or update a price item (MANAGER, STAFF, BILLING)
export async function POST(req: NextRequest) {
  const { user: user, error: authError } = await serviceGuard("service_prices", "create");
  if (authError) return authError;
  if (!user || !["MANAGER", "STAFF", "BILLING", "SUPERVISOR"].includes(user.roleName)) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  }

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
  const { user: user, error: authError } = await serviceGuard("service_prices", "delete");
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
