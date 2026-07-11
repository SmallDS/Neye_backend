import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { encryptSettingSecret } from './secret-crypto';

const OPTOMETRY_STYLE_KEY = 'optometry_style';
const WECHAT_AUTH_KEY = 'wechat_auth';
const VALID_VALUE_FIELDS = new Set([
  'Sph',
  'Cyl',
  'Axis',
  'Prism',
  'Base',
  'Add',
  'BcV',
  'BcH',
  'Dia',
  'Ucva',
  'Bcva',
]);

const DEFAULT_OPTOMETRY_STYLE = {
  hiddenValueFields: [],
  hiddenExtraFields: [],
  showRemark: true,
};

interface WechatAuthSettingValue {
  enabled?: boolean;
  appId?: string;
  encryptedSecret?: string;
}

@Injectable()
export class SystemSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async getWechatAuth() {
    const value = await this.getWechatAuthValue();
    const databaseSecretConfigured = Boolean(value.encryptedSecret);
    const environmentSecretConfigured = Boolean(
      process.env.WECHAT_MINIAPP_APP_SECRET,
    );
    return {
      enabled: value.enabled === true,
      appId:
        typeof value.appId === 'string' && value.appId.trim()
          ? value.appId.trim()
          : (process.env.WECHAT_MINIAPP_APP_ID ?? ''),
      secretConfigured:
        databaseSecretConfigured || environmentSecretConfigured,
      secretSource: databaseSecretConfigured
        ? 'database'
        : environmentSecretConfigured
          ? 'environment'
          : 'none',
    };
  }

  async updateWechatAuth(value: {
    appId?: string;
    appSecret?: string;
    clearSecret?: boolean;
    enabled: boolean;
  }) {
    const current = await this.getWechatAuthValue();
    let encryptedSecret = current.encryptedSecret;

    if (value.clearSecret === true) {
      encryptedSecret = undefined;
    } else if (value.appSecret?.trim()) {
      encryptedSecret = encryptSettingSecret(value.appSecret.trim());
    }

    const normalized: WechatAuthSettingValue = {
      enabled: value.enabled,
      appId: value.appId?.trim() ?? '',
      ...(encryptedSecret ? { encryptedSecret } : {}),
    };
    await this.prisma.systemSetting.upsert({
      where: { key: WECHAT_AUTH_KEY },
      create: {
        key: WECHAT_AUTH_KEY,
        value: normalized as Prisma.InputJsonValue,
      },
      update: { value: normalized as Prisma.InputJsonValue },
    });
    return this.getWechatAuth();
  }

  async getOptometryStyle() {
    const setting = await this.prisma.systemSetting.findUnique({
      where: { key: OPTOMETRY_STYLE_KEY },
    });
    return this.normalizeOptometryStyle(
      (setting?.value ?? DEFAULT_OPTOMETRY_STYLE) as Record<string, unknown>,
    );
  }

  async updateOptometryStyle(value: Record<string, unknown>) {
    const normalized = this.normalizeOptometryStyle(value);
    const setting = await this.prisma.systemSetting.upsert({
      where: { key: OPTOMETRY_STYLE_KEY },
      create: {
        key: OPTOMETRY_STYLE_KEY,
        value: normalized as Prisma.InputJsonValue,
      },
      update: { value: normalized as Prisma.InputJsonValue },
    });
    return setting.value;
  }

  private async getWechatAuthValue() {
    const setting = await this.prisma.systemSetting.findUnique({
      where: { key: WECHAT_AUTH_KEY },
    });
    return (setting?.value ?? {}) as WechatAuthSettingValue;
  }

  private normalizeOptometryStyle(value: Record<string, unknown>) {
    const hiddenValueFields =
      this.stringArray(value.hiddenValueFields).length > 0
        ? this.stringArray(value.hiddenValueFields)
        : this.legacyHiddenCellsToFields(value.hiddenCells);

    return {
      hiddenValueFields: hiddenValueFields.filter((field) =>
        VALID_VALUE_FIELDS.has(field),
      ),
      hiddenExtraFields: this.stringArray(value.hiddenExtraFields),
      showRemark: value.showRemark !== false,
    };
  }

  private legacyHiddenCellsToFields(value: unknown) {
    return [
      ...new Set(
        this.stringArray(value)
          .map((cell) => cell.split('.')[1])
          .filter(Boolean),
      ),
    ];
  }

  private stringArray(value: unknown) {
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string')
      : [];
  }
}
