const DEFAULT_IMPORT_FILE_NAME = 'customer-optometry-import.xlsx';
const MAX_STORED_FILE_NAME_LENGTH = 255;

function recoverUtf8FromLatin1(value: string) {
  if ([...value].some((character) => character.codePointAt(0)! > 0xff)) return value;
  const bytes = Buffer.from(value, 'latin1');
  const decoded = bytes.toString('utf8');
  if (decoded.includes('\uFFFD')) return value;
  return Buffer.from(decoded, 'utf8').equals(bytes) ? decoded : value;
}

export function normalizeImportFileName(value?: string) {
  if (!value || value.includes('\0') || value.includes('\uFFFD')) return DEFAULT_IMPORT_FILE_NAME;

  const recovered = recoverUtf8FromLatin1(value);
  if (recovered.includes('\0') || recovered.includes('\uFFFD')) return DEFAULT_IMPORT_FILE_NAME;

  const leafName = recovered.split(/[\\/]/).at(-1) ?? '';
  const sanitized = leafName.replace(/[\u0001-\u001f\u007f-\u009f]/g, '').trim().normalize('NFC');
  if (!sanitized || sanitized === '.' || sanitized === '..') return DEFAULT_IMPORT_FILE_NAME;

  const characters = [...sanitized];
  if (characters.length <= MAX_STORED_FILE_NAME_LENGTH) return sanitized;

  const extensionMatch = sanitized.match(/(\.[^.]{1,16})$/);
  const extension = extensionMatch?.[1] ?? '';
  return `${characters.slice(0, MAX_STORED_FILE_NAME_LENGTH - [...extension].length).join('')}${extension}`;
}