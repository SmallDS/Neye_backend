import { Body, Controller, Delete, Get, Ip, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUserContext } from '../common/decorators/current-user.decorator';
import { AuthGuard } from '../common/guards/auth.guard';
import { InMemoryRateLimiter } from '../common/security/in-memory-rate-limiter';
import { CurrentUser } from '../common/types/current-user';
import { AuthService } from './auth.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LoginDto } from './dto/login.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { WechatBindAccountDto } from './dto/wechat-bind-account.dto';
import { WechatBindCurrentDto } from './dto/wechat-bind-current.dto';
import { WechatMiniLoginDto } from './dto/wechat-mini-login.dto';
import { WechatSessionDecisionDto } from './dto/wechat-session-decision.dto';
import { WechatAuthService } from './wechat-auth.service';

const FIVE_MINUTES_MS = 5 * 60 * 1000;

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly wechatAuthService: WechatAuthService,
    private readonly rateLimiter: InMemoryRateLimiter,
  ) {}

  @Post('login')
  login(@Body() dto: LoginDto, @Ip() ip: string) {
    this.rateLimiter.consume('password-login-ip', ip, 10, FIVE_MINUTES_MS);
    this.rateLimiter.consume('password-login-account', dto.username, 6, FIVE_MINUTES_MS);
    return this.authService.login(dto);
  }

  @Get('wechat/config')
  getWechatConfig() {
    return this.wechatAuthService.getPublicConfig();
  }

  @Post('wechat/web-sessions')
  createWechatWebSession(@Ip() ip: string) {
    this.rateLimiter.consume('wechat-session-create', ip, 10, FIVE_MINUTES_MS);
    return this.wechatAuthService.createLoginSession();
  }

  @Get('wechat/web-sessions/:id')
  pollWechatWebSession(@Param('id') id: string, @Ip() ip: string) {
    this.rateLimiter.consume('wechat-session-poll', `${ip}:${id}`, 100, 3 * 60 * 1000);
    return this.wechatAuthService.pollSession(id);
  }

  @Post('wechat/web-sessions/:id/decision')
  decideWechatWebSession(
    @Param('id') id: string,
    @Body() dto: WechatSessionDecisionDto,
    @Ip() ip: string,
  ) {
    this.rateLimiter.consume('wechat-session-decision', `${ip}:${id}`, 10, FIVE_MINUTES_MS);
    return this.wechatAuthService.decideLoginSession(id, dto);
  }

  @Post('wechat/miniapp-login')
  loginFromWechatMiniapp(@Body() dto: WechatMiniLoginDto, @Ip() ip: string) {
    this.rateLimiter.consume('wechat-mini-login', ip, 20, FIVE_MINUTES_MS);
    return this.wechatAuthService.loginFromMiniapp(dto);
  }

  @Post('wechat/bind-account')
  bindWechatAccount(@Body() dto: WechatBindAccountDto, @Ip() ip: string) {
    this.rateLimiter.consume('wechat-bind-account-ip', ip, 10, FIVE_MINUTES_MS);
    this.rateLimiter.consume('wechat-bind-account-user', dto.username, 6, FIVE_MINUTES_MS);
    return this.wechatAuthService.bindAccount(dto);
  }

  @Post('wechat/bind-sessions')
  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  createWechatBindingSession(@CurrentUserContext() user: CurrentUser) {
    this.rateLimiter.consume('wechat-binding-session', user.id, 10, FIVE_MINUTES_MS);
    return this.wechatAuthService.createBindingSession(user);
  }

  @Post('wechat/binding')
  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  bindCurrentWechat(
    @CurrentUserContext() user: CurrentUser,
    @Body() dto: WechatBindCurrentDto,
  ) {
    this.rateLimiter.consume('wechat-bind-current', user.id, 10, FIVE_MINUTES_MS);
    return this.wechatAuthService.bindCurrentUser(user, dto.code);
  }

  @Delete('wechat/binding')
  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  unbindCurrentWechat(@CurrentUserContext() user: CurrentUser) {
    return this.wechatAuthService.unbindCurrentUser(user);
  }

  @Get('me')
  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  me(@CurrentUserContext() user: CurrentUser) {
    return this.authService.getProfile(user);
  }

  @Patch('me')
  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  updateProfile(@CurrentUserContext() user: CurrentUser, @Body() dto: UpdateProfileDto) {
    return this.authService.updateProfile(user, dto);
  }

  @Patch('password')
  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  changePassword(@CurrentUserContext() user: CurrentUser, @Body() dto: ChangePasswordDto) {
    this.rateLimiter.consume('password-change', user.id, 6, FIVE_MINUTES_MS);
    return this.authService.changePassword(user.id, dto);
  }
}
