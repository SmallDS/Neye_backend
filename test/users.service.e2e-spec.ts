import { UserRole, UserStatus } from '@prisma/client';
import { CurrentUser } from '../src/common/types/current-user';
import { PrismaService } from '../src/prisma/prisma.service';
import { UsersService } from '../src/users/users.service';

describe('UsersService admin role updates', () => {
  it('demotes an active admin after acquiring the transaction lock', async () => {
    const accountId = '00000000-0000-0000-0000-000000000002';
    const actor: CurrentUser = {
      id: '00000000-0000-0000-0000-000000000001',
      tenantId: null,
      tenantIds: [],
      username: 'admin',
      displayName: 'Admin',
      role: UserRole.admin,
    };
    const currentAccount = {
      id: accountId,
      username: 'secondary-admin',
      displayName: 'Secondary Admin',
      role: UserRole.admin,
      status: UserStatus.active,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      tenantMemberships: [],
    };
    const updatedAccount = { ...currentAccount, role: UserRole.staff };
    const transactionClient = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      user: {
        count: jest.fn().mockResolvedValue(1),
        update: jest.fn().mockResolvedValue(updatedAccount),
      },
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (tx: typeof transactionClient) => Promise<unknown>) =>
        callback(transactionClient),
      ),
      user: {
        findUnique: jest.fn().mockResolvedValue(currentAccount),
      },
    } as unknown as PrismaService;
    const service = new UsersService(prisma);

    const result = await service.update(actor, accountId, { role: UserRole.staff });

    expect(transactionClient.$executeRaw).toHaveBeenCalledTimes(1);
    expect(transactionClient.user.count).toHaveBeenCalledWith({
      where: {
        id: { notIn: [accountId] },
        role: UserRole.admin,
        status: UserStatus.active,
      },
    });
    expect(transactionClient.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { role: UserRole.staff },
        where: { id: accountId },
      }),
    );
    expect(result).toMatchObject({ id: accountId, role: UserRole.staff, tenants: [] });
  });
});
