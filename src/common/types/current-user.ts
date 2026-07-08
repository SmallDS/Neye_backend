import { UserRole } from '@prisma/client';

export interface CurrentUser {
  id: string;
  tenantId: string | null;
  username: string;
  displayName: string;
  role: UserRole;
}