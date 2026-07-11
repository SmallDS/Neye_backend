import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUserContext } from '../common/decorators/current-user.decorator';
import { AuthGuard } from '../common/guards/auth.guard';
import { CurrentUser } from '../common/types/current-user';
import { AuthService } from './auth.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LoginDto } from './dto/login.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { WechatBindAccountDto } from './dto/wechat-bind-account.dto';
import { WechatBindCurrentDto } from './dto/wechat-bind-current.dto';
import { WechatMiniLoginDto } from './dto/wechat-mini-login.dto';
import { WechatAuthService } from './wechat-auth.service';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly wechatAuthService: WechatAuthService,
  ) {}

  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Get('wechat/config')
  getWechatConfig() {
    return this.wechatAuthService.getPublicConfig();
  }

  @Post('wechat/web-sessions')
  createWechatWebSession() {
    return this.wechatAuthService.createLoginSession();
  }

  @Get('wechat/web-sessions/:id')
  pollWechatWebSession(@Param('id') id: string) {
    return this.wechatAuthService.pollSession(id);
  }

  @Post('wechat/miniapp-login')
  loginFromWechatMiniapp(@Body() dto: WechatMiniLoginDto) {
    return this.wechatAuthService.loginFromMiniapp(dto);
  }

  @Post('wechat/bind-account')
  bindWechatAccount(@Body() dto: WechatBindAccountDto) {
    return this.wechatAuthService.bindAccount(dto);
  }

  @Post('wechat/bind-sessions')
  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  createWechatBindingSession(@CurrentUserContext() user: CurrentUser) {
    return this.wechatAuthService.createBindingSession(user);
  }

  @Post('wechat/binding')
  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  bindCurrentWechat(
    @CurrentUserContext() user: CurrentUser,
    @Body() dto: WechatBindCurrentDto,
  ) {
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
    return this.authService.changePassword(user.id, dto);
  }
}
