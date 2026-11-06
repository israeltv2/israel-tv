// Secrets of the admin gate: constant-time comparison, and the CSRF value a browser session must send.
import { createHmac, timingSafeEqual } from 'node:crypto';

/** Constant-time comparison of two secrets. */
export function sameSecret(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** The CSRF value for a browser session: derived from the admin token, so nothing extra is stored. */
export function csrfFor(token: string): string {
  return createHmac('sha256', token).update('israel-tv csrf').digest('base64url');
}
