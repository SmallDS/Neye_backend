import { BadRequestException } from '@nestjs/common';
import { IMPORT_CAPABILITIES, MAX_IMPORT_FILE_BYTES, validateImportUpload } from '../src/import-tasks/import-file-validation';

describe('validateImportUpload', () => {
  it('accepts an xlsx ZIP signature', () => {
    expect(() =>
      validateImportUpload({
        originalname: 'import.xlsx',
        mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        buffer: Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]),
      }),
    ).not.toThrow();
  });

  it('rejects a mismatched extension and signature', () => {
    expect(() => validateImportUpload({ originalname: 'import.xlsx', buffer: Buffer.from('not-an-excel-file') })).toThrow(BadRequestException);
  });

  it('rejects files larger than the configured default 50 MB', () => {
    expect(IMPORT_CAPABILITIES.maxFileBytes).toBe(50 * 1024 * 1024);
    expect(() => validateImportUpload({ originalname: 'import.xlsx', buffer: Buffer.alloc(MAX_IMPORT_FILE_BYTES + 1) })).toThrow(
      'Import file must not exceed 50 MB',
    );
  });
});