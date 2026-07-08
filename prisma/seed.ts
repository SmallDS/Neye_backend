import { PrismaClient, UserRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const username = process.env.SEED_ADMIN_USERNAME ?? process.env.SEED_SYSTEM_ADMIN_USERNAME ?? 'admin';
  const password = process.env.SEED_ADMIN_PASSWORD ?? process.env.SEED_SYSTEM_ADMIN_PASSWORD ?? 'Admin123456';

  if (process.env.NODE_ENV === 'production' && !process.env.SEED_ADMIN_PASSWORD && !process.env.SEED_SYSTEM_ADMIN_PASSWORD) {
    throw new Error('SEED_ADMIN_PASSWORD is required in production');
  }

  const existed = await prisma.user.findUnique({ where: { username } });
  if (existed) {
    await prisma.user.update({ where: { id: existed.id }, data: { role: UserRole.admin } });
    console.log(`Admin already exists: ${username}`);
    return;
  }

  await prisma.user.create({
    data: {
      username,
      passwordHash: await bcrypt.hash(password, 10),
      displayName: 'Admin',
      role: UserRole.admin,
      tenantId: null,
    },
  });

  console.log(`Created admin: ${username}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => prisma.$disconnect());