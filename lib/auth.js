import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { query } from './db.js';

const SECRET = process.env.JWT_SECRET || 'dev-only-change-me';
const COOKIE_NAME = 'lyralo_admin';
const TTL = '7d';

export function signToken(admin) {
  return jwt.sign(
    { sub: admin.id, email: admin.email, role: admin.role },
    SECRET,
    { expiresIn: TTL }
  );
}

export function verifyToken(token) {
  try { return jwt.verify(token, SECRET); }
  catch { return null; }
}

export async function login(email, password) {
  const r = await query(`SELECT * FROM admins WHERE email = $1`, [email.toLowerCase()]);
  const admin = r.rows[0];
  if (!admin) return null;
  if (!bcrypt.compareSync(password, admin.password_hash)) return null;
  await query(`UPDATE admins SET last_login_at = now() WHERE id = $1`, [admin.id]);
  return admin;
}

// Express middleware
export function requireAdmin(req, res, next) {
  const token = req.cookies?.[COOKIE_NAME] || req.headers.authorization?.replace(/^Bearer /, '');
  const payload = token ? verifyToken(token) : null;
  if (!payload) return res.status(401).json({ error: 'unauthorized' });
  req.admin = payload;
  next();
}

// Secure cookies require HTTPS. Set COOKIE_SECURE=true once your app is on
// HTTPS (e.g. https://app.lyralo.com). On plain HTTP (sslip.io etc.) the
// browser silently drops cookies marked "Secure" — keep this false until
// HTTPS is wired up.
const COOKIE_SECURE = process.env.COOKIE_SECURE === 'true';

export function setAuthCookie(res, token) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: COOKIE_SECURE,
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000
  });
}

export function clearAuthCookie(res) {
  res.clearCookie(COOKIE_NAME);
}

export { COOKIE_NAME };
