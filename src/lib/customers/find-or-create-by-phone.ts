import { Prisma } from "@prisma/client";
import { bare10, toPlus91 } from "@/lib/phone";
import { createLogger } from "@/lib/logger";

const log = createLogger("customers:find-or-create");

type Tx = Prisma.TransactionClient;

/**
 * Find the Customer by phone, or create one (plan 1609-deliveries, A1, A13).
 *
 * The phone is the identity (`Customer.phone @unique`). A new row is written `+91-XXXXXXXXXX`;
 * an existing row may be in that form or, from the receivables import and the workshop, bare 10
 * digits — both are looked up, the `+91-` form first. An existing row is NEVER changed (R8, A4 of
 * the requirements: "ignore if already present"), even if the name differs.
 *
 * A concurrent create of the same number hits the unique index; that is caught and re-read, so
 * two people pressing Save at once both end up linked to one row.
 *
 * Throws when the phone has no digits. Call inside the caller's transaction.
 */
export async function findOrCreateCustomerByPhone(
  tx: Tx,
  input: { name: string; phone: string }
): Promise<{ id: string; name: string; phone: string; alreadyExisted: boolean }> {
  const plus91 = toPlus91(input.phone);
  if (!plus91) throw new Error("Enter the customer's phone number.");
  const candidates = [plus91, bare10(plus91)].filter((p): p is string => !!p);

  const find = async () => {
    const rows = await tx.customer.findMany({
      where: { phone: { in: candidates } },
      select: { id: true, name: true, phone: true },
    });
    return rows.find((r) => r.phone === plus91) ?? rows[0] ?? null;
  };

  const existing = await find();
  if (existing) {
    log.info("customer matched by phone", { customerId: existing.id });
    return { ...existing, alreadyExisted: true };
  }

  const name = input.name.trim() || "Customer";
  try {
    // A savepoint, so a unique-violation does not abort the caller's whole transaction.
    await tx.$executeRaw`SAVEPOINT customer_create`;
    const created = await tx.customer.create({
      data: { name, phone: plus91, type: "WALK_IN" },
      select: { id: true, name: true, phone: true },
    });
    await tx.$executeRaw`RELEASE SAVEPOINT customer_create`;
    log.info("customer created", { customerId: created.id });
    return { ...created, alreadyExisted: false };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      await tx.$executeRaw`ROLLBACK TO SAVEPOINT customer_create`;
      const raced = await find();
      if (raced) {
        log.warn("customer create raced — linked the row created concurrently", { customerId: raced.id });
        return { ...raced, alreadyExisted: true };
      }
    }
    log.error("customer create failed", { error: err instanceof Error ? err.message : String(err) });
    throw err;
  }
}
