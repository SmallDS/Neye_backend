import { BadRequestException } from '@nestjs/common';
import { loadImportCapabilities } from './import-config';
import { normalizeImportFileName } from './import-file-name';

export const IMPORT_CAPABILITIES = loadImportCapabilities();
export const MAX_IMPORT_FILE_BYTES = IMPORT_CAPABILITIES.maxFileBytes;

const ALLOWED_MIME_TYPES = new Set([
  'application/octet-stream',
  'application/zip',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);
const OLE_SIGNATURE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

export interface ImportUploadFile {
  buffer?: Buffer;
  originalname?: string;
  mimetype?: string;
  size?: number;
}

export function validateImportUpload(file: ImportUploadFile | undefined): asserts file is ImportUploadFile & { buffer: Buffer } {
  if (!file?.buffer) throw new BadRequestException('Import file is required');
  if (file.buffer.length > IMPORT_CAPABILITIES.maxFileBytes) {
    throw new BadRequestException(`Import file must not exceed ${Math.floor(IMPORT_CAPABILITIES.maxFileBytes / 1024 / 1024)} MB`);
  }

  const fileName = normalizeImportFileName(file.originalname);
  const extension = /\.xlsx$/i.test(fileName) ? 'xlsx' : /\.xls$/i.test(fileName) ? 'xls' : undefined;
  if (!extension) throw new BadRequestException('Only xlsx/xls files are supported');
  if (file.mimetype && !ALLOWED_MIME_TYPES.has(file.mimetype.toLowerCase())) {
    throw new BadRequestException('Import file MIME type is not supported');
  }

  const isZip = file.buffer.length >= 4 && file.buffer[0] === 0x50 && file.buffer[1] === 0x4b && [0x03, 0x05, 0x07].includes(file.buffer[2]);
  const isOle = file.buffer.length >= OLE_SIGNATURE.length && file.buffer.subarray(0, OLE_SIGNATURE.length).equals(OLE_SIGNATURE);
  if ((extension === 'xlsx' && !isZip) || (extension === 'xls' && !isOle)) {
    throw new BadRequestException('Import file content does not match its extension');
  }
}