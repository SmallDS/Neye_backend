import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { InMemoryRateLimiter } from '../common/security/in-memory-rate-limiter';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { WechatAuthService } from './wechat-auth.service';

const jwtSecret = process.env.JWT_SECRET;
if (process.env.NODE_ENV === 'production' && (!jwtSecret || /dev-only|change-me/i.test(jwtSecret))) {
  throw new Error('A strong JWT_SECRET is required in production');
}

@Global()
@Module({
  imports: [
    JwtModule.register({
      secret: jwtSecret ?? 'dev-only-change-me',
      signOptions: { expiresIn: (process.env.JWT_EXPIRES_IN ?? '12h') as never },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, WechatAuthService, InMemoryRateLimiter],
  exports: [JwtModule],
})
export class AuthModule {}
