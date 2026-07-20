import { Global, Module } from '@nestjs/common';
import { WechatApiClient } from './wechat-api.client';

@Global()
@Module({ providers: [WechatApiClient], exports: [WechatApiClient] })
export class WechatModule {}