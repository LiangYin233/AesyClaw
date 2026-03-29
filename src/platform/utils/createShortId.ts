import { randomUUID } from 'crypto';

export function createShortId(length = 8): string {
  return randomUUID().slice(0, length);
}