import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUserContext } from '../common/decorators/current-user.decorator';
import { AuthGuard } from '../common/guards/auth.guard';
import { CurrentUser } from '../common/types/current-user';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Get('me')
  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  me(@CurrentUserContext() user: CurrentUser) {
    return user;
  }
}