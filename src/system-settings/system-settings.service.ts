import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const OPTOMETRY_STYLE_KEY = 'optometry_style';
const VALID_VALUE_FIELDS = new Set(['Sph', 'Cyl', 'Axis', 'Prism', 'Base', 'Add', 'BcV', 'BcH', 'Dia', 'Ucva', 'Bcva']);

const DEFAULT_OPTOMETRY_STYLE = {
  hiddenValueFields: [],
  hiddenExtraFields: [],
  showRemark: true,
};

@Injectable()
export class SystemSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async getOptometryStyle() {
    const setting = await this.prisma.systemSetting.findUnique({ where: { key: OPTOMETRY_STYLE_KEY } });
    return this.normalizeOptometryStyle((setting?.value ?? DEFAULT_OPTOMETRY_STYLE) as Record<string, unknown>);
  }

  async updateOptometryStyle(value: Record<string, unknown>) {
    const normalized = this.normalizeOptometryStyle(value);
    const setting = await this.prisma.systemSetting.upsert({
      where: { key: OPTOMETRY_STYLE_KEY },
      create: { key: OPTOMETRY_STYLE_KEY, value: normalized as Prisma.InputJsonValue },
      update: { value: normalized as Prisma.InputJsonValue },
    });
    return setting.value;
  }

  private normalizeOptometryStyle(value: Record<string, unknown>) {
    const hiddenValueFields = this.stringArray(value.hiddenValueFields).length > 0
      ? this.stringArray(value.hiddenValueFields)
      : this.legacyHiddenCellsToFields(value.hiddenCells);

    return {
      hiddenValueFields: hiddenValueFields.filter((field) => VALID_VALUE_FIELDS.has(field)),
      hiddenExtraFields: this.stringArray(value.hiddenExtraFields),
      showRemark: value.showRemark !== false,
    };
  }

  private legacyHiddenCellsToFields(value: unknown) {
    return [...new Set(this.stringArray(value).map((cell) => cell.split('.')[1]).filter(Boolean))];
  }

  private stringArray(value: unknown) {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  }
}