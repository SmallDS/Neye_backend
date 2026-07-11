import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

const VERSION = 'v1';
const ALGORITHM = 'aes-256-gcm';

function encryptionKey() {
  const material =
    process.env.SETTINGS_ENCRYPTION_KEY ??
    process.env.JWT_SECRET ??
    'dev-only-change-me';
  return createHash('sha256').update(material).digest();
}

export function encryptSettingSecret(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, encryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(value, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    VERSION,
    iv.toString('base64url'),
    tag.toString('base64url'),
    encrypted.toString('base64url'),
  ].join(':');
}

export function decryptSettingSecret(value: string) {
  const [version, ivValue, tagValue, encryptedValue] = value.split(':');
  if (
    version !== VERSION ||
    !ivValue ||
    !tagValue ||
    encryptedValue === undefined
  ) {
    throw new Error('Unsupported encrypted setting format');
  }
  const decipher = createDecipheriv(
    ALGORITHM,
    encryptionKey(),
    Buffer.from(ivValue, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}
