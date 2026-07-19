import { PrismaClient, UserRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const username = process.env.SEED_ADMIN_USERNAME ?? process.env.SEED_SYSTEM_ADMIN_USERNAME ?? 'admin';
  const configuredPassword = process.env.SEED_ADMIN_PASSWORD ?? process.env.SEED_SYSTEM_ADMIN_PASSWORD;
  const password = configuredPassword ?? 'Admin123456';
  const displayName = process.env.SEED_ADMIN_DISPLAY_NAME ?? 'Admin';

  if (
    process.env.NODE_ENV === 'production' &&
    (!configuredPassword || ['Admin123456', 'change-me-before-deploy'].includes(configuredPassword))
  ) {
    throw new Error('SEED_ADMIN_PASSWORD must be set to a non-placeholder value in production');
  }

  const existed = await prisma.user.findUnique({ where: { username } });
  if (existed) {
    if (existed.role !== UserRole.admin) {
      throw new Error(`Refusing to promote existing non-admin user: ${username}`);
    }
    console.log(`Admin already exists: ${username}`);
    return;
  }

  await prisma.user.create({
    data: {
      username,
      passwordHash: await bcrypt.hash(password, 10),
      displayName,
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
