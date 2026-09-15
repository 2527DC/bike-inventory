import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const vendors = await prisma.vendor.findMany({
    include: {
      ledgerEntries: true,
      ledgerGaps: true
    }
  });

  const emptyVendors = vendors.filter(v => v.ledgerEntries.length === 0 && v.ledgerGaps.length === 0);
  console.log("Empty vendors:", emptyVendors.map(v => v.name).join(", "));
}

main().catch(console.error).finally(() => prisma.$disconnect());
