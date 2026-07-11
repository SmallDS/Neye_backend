import { pinyin } from 'pinyin-pro';

export interface CustomerNameSearchFields {
  nameInitials: string;
  namePinyin: string;
}

function compact(value: string) {
  return value.normalize('NFKC').toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function buildCustomerNameSearchFields(name: string): CustomerNameSearchFields {
  const options = {
    nonZh: 'consecutive' as const,
    separator: '',
    surname: 'head' as const,
    toneType: 'none' as const,
    v: true,
  };

  return {
    namePinyin: compact(pinyin(name, options)),
    nameInitials: compact(pinyin(name, { ...options, pattern: 'first' })),
  };
}

export function normalizeCustomerPinyinKeyword(keyword: string) {
  return compact(keyword);
}