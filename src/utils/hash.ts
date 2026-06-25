import { createHash, randomBytes } from 'crypto';

export function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function randomToken(byteLength = 24): string {
  return randomBytes(byteLength).toString('hex');
}
