import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { TenantStatus, UserRole, UserStatus } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { username: dto.username },
      include: { tenant: true },
    });
    if (!user || user.status !== UserStatus.active) {
      throw new UnauthorizedException('Invalid username or password');
    }
    if (user.role !== UserRole.admin && user.tenant?.status !== TenantStatus.active) {
      throw new UnauthorizedException('Invalid username or password');
    }

    const isValid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!isValid) {
      throw new UnauthorizedException('Invalid username or password');
    }

    const payload = {
      id: user.id,
      tenantId: user.tenantId,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
    };

    return {
      accessToken: await this.jwtService.signAsync(payload),
      user: {
        ...payload,
        tenant: user.tenant
          ? { id: user.tenant.id, code: user.tenant.code, name: user.tenant.name }
          : undefined,
      },
    };
  }
}