import { createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const COOKIE_NAME = 'fixtech_session';
const SESSION_SECONDS = 8 * 60 * 60;

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${Buffer.from(derived).toString('hex')}`;
}

export async function verifyPassword(password, encoded) {
  const [scheme, saltHex, hashHex] = String(encoded ?? '').split('$');
  if (scheme !== 'scrypt' || !/^[a-f0-9]{32}$/i.test(saltHex ?? '') || !/^[a-f0-9]{128}$/i.test(hashHex ?? '')) return false;
  const actual = Buffer.from(await scrypt(password, Buffer.from(saltHex, 'hex'), 64));
  return timingSafeEqual(actual, Buffer.from(hashHex, 'hex'));
}

function signature(value, secret) {
  return createHmac('sha256', secret).update(value).digest('base64url');
}

export function issueSession(userId, secret, now = Date.now()) {
  if (!secret || Buffer.byteLength(secret) < 32) throw new Error('SESSION_SECRET must contain at least 32 bytes');
  const payload = `${userId}.${Math.floor(now / 1000) + SESSION_SECONDS}`;
  return `${payload}.${signature(payload, secret)}`;
}

export function readSession(token, secret, now = Date.now()) {
  if (!secret || typeof token !== 'string') return null;
  const [userId, expiresText, supplied, extra] = token.split('.');
  if (!userId || !expiresText || !supplied || extra !== undefined || !/^[0-9a-f-]{36}$/i.test(userId)) return null;
  const payload = `${userId}.${expiresText}`;
  const expected = Buffer.from(signature(payload, secret));
  const actual = Buffer.from(supplied);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  if (!/^\d+$/.test(expiresText) || Number(expiresText) <= Math.floor(now / 1000)) return null;
  return userId;
}

export function sessionCookie(token, { secure = false, clear = false } = {}) {
  const value = clear ? '' : token;
  const age = clear ? 0 : SESSION_SECONDS;
  return `${COOKIE_NAME}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${secure ? '; Secure' : ''}`;
}

export function getSessionToken(req) {
  const cookie = req.headers.cookie ?? '';
  for (const part of cookie.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === COOKIE_NAME) return rest.join('=');
  }
  return null;
}

export const SESSION_COOKIE_NAME = COOKIE_NAME;
