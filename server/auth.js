import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { config } from './config.js';
import { db } from './db.js';

const scrypt = promisify(crypto.scrypt);
const COOKIE = 'tef_sessao';
const MAX_AGE_S = 60 * 60 * 24 * 60; // 60 dias

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function checkPassword(password, stored) {
  const [kind, saltB64, hashB64] = String(stored || '').split('$');
  if (kind !== 'scrypt') return false;
  const expected = Buffer.from(hashB64, 'base64');
  const got = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length);
  return crypto.timingSafeEqual(expected, got);
}

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = crypto.createHmac('sha256', config.sessionSecret).update(body).digest('base64url');
  return `${body}.${mac}`;
}

export function verifyToken(token) {
  const [body, mac] = String(token || '').split('.');
  if (!body || !mac) return null;
  const expected = crypto.createHmac('sha256', config.sessionSecret).update(body).digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (!data.exp || data.exp < Date.now() / 1000) return null;
    return data;
  } catch {
    return null;
  }
}

// Token curto para baixar arquivos (links de download nao levam cookie em todos os navegadores de app).
export function signShort(payload, seconds) {
  return sign({ ...payload, exp: Math.floor(Date.now() / 1000) + seconds });
}

function readCookie(req, name) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > -1 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

export function setSession(res, userId) {
  const token = sign({ uid: userId, exp: Math.floor(Date.now() / 1000) + MAX_AGE_S });
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProd,
    maxAge: MAX_AGE_S * 1000,
    path: '/',
  });
}

export function clearSession(res) {
  res.clearCookie(COOKIE, { path: '/' });
}

export async function loadUser(req, _res, next) {
  req.user = null;
  const data = verifyToken(readCookie(req, COOKIE));
  if (data?.uid) {
    req.user = await db.one(
      `select u.id, u.email, u.name, u.phone, u.role, p.status as photographer_status, p.slug as photographer_slug,
              (select count(*) from user_matches m join photos p on p.id = m.photo_id and not p.hidden where m.user_id = u.id and not m.seen)::int as matches_new
         from users u left join photographers p on p.user_id = u.id where u.id = $1`,
      [data.uid],
    );
  }
  next();
}

export function requireUser(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Entre na sua conta para continuar.' });
  next();
}

export function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Acesso restrito ao administrador.' });
  next();
}

// Fotografo aprovado (ou admin, que tambem pode publicar eventos proprios).
export function requirePhotographer(req, res, next) {
  const u = req.user;
  if (!u) return res.status(401).json({ error: 'Entre na sua conta para continuar.' });
  if (u.role === 'admin') return next();
  if (u.role !== 'photographer') return res.status(403).json({ error: 'Area exclusiva para fotografos.' });
  if (u.photographer_status !== 'approved') {
    return res.status(403).json({ error: 'Seu cadastro de fotografo ainda esta em analise.', pending: true });
  }
  next();
}
