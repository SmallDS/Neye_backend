import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma, TenantStatus, UserRole, UserStatus } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { CurrentUser } from '../common/types/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LoginDto } from './dto/login.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';

const userWithTenants = Prisma.validator<Prisma.UserDefaultArgs>()({
  include: {
    tenantMemberships: {
      include: { tenant: true },
      orderBy: { assignedAt: 'asc' },
    },
    wechatBinding: true,
  },
});

type UserWithTenants = Prisma.UserGetPayload<typeof userWithTenants>;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async login(dto: LoginDto) {
    let user = await this.prisma.user.findUnique({
      where: { username: dto.username },
      ...userWithTenants,
    });
    if (!user || user.status !== UserStatus.active) {
      throw new UnauthorizedException('Invalid username or password');
    }

    const isValid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!isValid) {
      throw new UnauthorizedException('Invalid username or password');
    }

    user = await this.syncLegacyMembership(user);
    const payload = {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
    };

    return {
      accessToken: await this.jwtService.signAsync(payload),
      user: this.toProfile(user),
    };
  }

  async loginByUserId(userId: string) {
    const user = await this.findUser(userId);
    return {
      accessToken: await this.jwtService.signAsync({
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        role: user.role,
      }),
      user: this.toProfile(user),
    };
  }

  async getProfile(currentUser: CurrentUser) {
    const user = await this.findUser(currentUser.id);
    return this.toProfile(user, currentUser.tenantId);
  }

  async updateProfile(currentUser: CurrentUser, dto: UpdateProfileDto) {
    const user = await this.prisma.user.update({
      where: { id: currentUser.id },
      data: { displayName: dto.displayName },
      ...userWithTenants,
    });
    return this.toProfile(user, currentUser.tenantId);
  }

  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !(await bcrypt.compare(dto.currentPassword, user.passwordHash))) {
      throw new UnauthorizedException('Current password is incorrect');
    }
    if (await bcrypt.compare(dto.newPassword, user.passwordHash)) {
      throw new BadRequestException('New password must be different from the current password');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await bcrypt.hash(dto.newPassword, 10) },
    });
    return { message: 'Password changed successfully' };
  }

  private async findUser(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      ...userWithTenants,
    });
    if (!user || user.status !== UserStatus.active) {
      throw new UnauthorizedException('Invalid bearer token');
    }
    return this.syncLegacyMembership(user);
  }

  private async syncLegacyMembership(user: UserWithTenants): Promise<UserWithTenants> {
    if (!user.tenantId || user.tenantMemberships.some((membership) => membership.tenantId === user.tenantId)) {
      return user;
    }

    await this.prisma.$transaction([
      this.prisma.userTenant.upsert({
        where: { userId_tenantId: { userId: user.id, tenantId: user.tenantId } },
        create: { userId: user.id, tenantId: user.tenantId },
        update: {},
      }),
      this.prisma.user.update({
        where: { id: user.id },
        data: { tenantId: null },
      }),
    ]);

    return this.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      ...userWithTenants,
    });
  }

  private toProfile(user: UserWithTenants, requestedTenantId?: string | null) {
    const tenants = user.tenantMemberships.map(({ assignedAt, tenant }) => ({
      id: tenant.id,
      code: tenant.code,
      name: tenant.name,
      status: tenant.status,
      assignedAt,
    }));
    const activeTenants = tenants.filter((tenant) => tenant.status === TenantStatus.active);
    const tenantId =
      user.role === UserRole.admin
        ? null
        : activeTenants.some((tenant) => tenant.id === requestedTenantId)
          ? requestedTenantId!
          : activeTenants[0]?.id ?? null;
    const tenant = activeTenants.find((item) => item.id === tenantId);

    return {
      id: user.id,
      tenantId,
      tenantIds: activeTenants.map((item) => item.id),
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      tenant,
      tenants,
      wechatBound: Boolean(user.wechatBinding),
    };
  }
}