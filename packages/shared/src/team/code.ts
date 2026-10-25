// Pairing codes: 8 characters from an alphabet without look-alikes (no 0/O, 1/I), shown as `ABCD-EFGH`.
import { PAIRING_CODE_LENGTH } from './types';

export const PAIRING_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Upper case, without spaces and dashes. Characters outside the alphabet are kept so the check can refuse them. */
export function normalizePairingCode(raw: string): string {
  return raw.toUpperCase().replace(/[\s\-_.]/g, '');
}

export function isValidPairingCode(code: string): boolean {
  if (code.length !== PAIRING_CODE_LENGTH) return false;
  for (const char of code) if (!PAIRING_ALPHABET.includes(char)) return false;
  return true;
}

/** `ABCDEFGH` -> `ABCD-EFGH`. */
export function formatPairingCode(code: string): string {
  const half = PAIRING_CODE_LENGTH / 2;
  return code.length === PAIRING_CODE_LENGTH ? `${code.slice(0, half)}-${code.slice(half)}` : code;
}
