import { normalizeImportFileName } from '../src/import-tasks/import-file-name';

describe('normalizeImportFileName', () => {
  const chineseFileName = '\u5ba2\u6237\u9a8c\u5149\u5355\u5bfc\u5165_\u8fc1\u79fb\u7ed3\u679c.xlsx';

  it('recovers a UTF-8 filename decoded as Latin-1 by multipart middleware', () => {
    const mojibake = Buffer.from(chineseFileName, 'utf8').toString('latin1');
    expect(normalizeImportFileName(mojibake)).toBe(chineseFileName);
  });

  it('keeps normal Chinese and English filenames unchanged', () => {
    expect(normalizeImportFileName(chineseFileName)).toBe(chineseFileName);
    expect(normalizeImportFileName('customer-import.xlsx')).toBe('customer-import.xlsx');
  });

  it('drops path components and rejects invalid replacement or null characters', () => {
    expect(normalizeImportFileName(`..\\temp\\${chineseFileName}`)).toBe(chineseFileName);
    expect(normalizeImportFileName('bad\uFFFD.xlsx')).toBe('customer-optometry-import.xlsx');
    expect(normalizeImportFileName('bad\0.xlsx')).toBe('customer-optometry-import.xlsx');
  });
});