import { PrismaClient } from '@prisma/client';
import { buildCustomerNameSearchFields } from '../src/customers/customer-name-search';

const prisma = new PrismaClient();
const batchSize = 200;

async function main() {
  let updated = 0;
  let cursor: string | undefined;

  while (true) {
    const customers = await prisma.customer.findMany({
      where: {
        OR: [{ namePinyin: null }, { nameInitials: null }],
      },
      orderBy: { id: 'asc' },
      take: batchSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: { id: true, name: true },
    });

    if (customers.length === 0) break;

    await prisma.$transaction(
      customers.map((customer) =>
        prisma.customer.update({
          where: { id: customer.id },
          data: buildCustomerNameSearchFields(customer.name),
        }),
      ),
    );

    updated += customers.length;
    cursor = customers.at(-1)?.id;
  }

  console.log(`[customer-pinyin] backfilled ${updated} customers`);
}

main()
  .catch((error) => {
    console.error('[customer-pinyin] backfill failed', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });