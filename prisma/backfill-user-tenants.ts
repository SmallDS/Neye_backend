import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const legacyUsers = await prisma.user.findMany({
    where: { tenantId: { not: null } },
    select: { id: true, tenantId: true },
  });

  let synchronized = 0;
  for (const user of legacyUsers) {
    if (!user.tenantId) continue;
    await prisma.userTenant.upsert({
      where: {
        userId_tenantId: {
          userId: user.id,
          tenantId: user.tenantId,
        },
      },
      create: {
        userId: user.id,
        tenantId: user.tenantId,
      },
      update: {},
    });
    synchronized += 1;
  }

  if (synchronized > 0) {
    await prisma.user.updateMany({
      where: { tenantId: { not: null } },
      data: { tenantId: null },
    });
  }

  console.log(`Synchronized ${synchronized} legacy user-tenant membership(s).`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });