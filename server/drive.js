import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import sharp from 'sharp';
import { db } from './db.js';
import { dirs, fileSha, saveOriginal, renderPhoto } from './storage.js';
import { uniqueSlug } from './util.js';

// Importacao do Google Drive. Estrutura esperada (uma pasta por ano):
//   2026/                                  <- pasta ligada no painel
//     2026-09-12 Formatura CEJA - Criciuma/  <- vira um evento (data, nome e cidade vem do nome da pasta)
//       *.jpg (subpastas tambem valem)
//     foto-solta.jpg                       <- vai para o evento "Fotos de 2026"
// Acesso: conta de servico (GOOGLE_SERVICE_ACCOUNT_JSON; a pasta fica privada, compartilhada com o e-mail
// da conta) ou chave de API (GOOGLE_API_KEY; a pasta precisa estar como "qualquer pessoa com o link").

const API = 'https://www.googleapis.com/drive/v3';
const SYNC_MINUTES = Math.max(2, Number(process.env.DRIVE_SYNC_MINUTES) || 10);
const FILES_PER_RUN = 40;
const MIN_SIDE = 600;
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

function serviceAccount() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  try {
    const json = JSON.parse(raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8'));
    return json.client_email && json.private_key ? json : null;
  } catch {
    console.error('[drive] GOOGLE_SERVICE_ACCOUNT_JSON invalido');
    return null;
  }
}
const apiKey = () => process.env.GOOGLE_API_KEY || '';

export function driveInfo() {
  const sa = serviceAccount();
  return {
    configured: !!(sa || apiKey()),
    mode: sa ? 'service_account' : apiKey() ? 'api_key' : null,
    share_with: sa?.client_email || null,
    sync_minutes: SYNC_MINUTES,
  };
}

let token = null;
async function authHeaders() {
  const sa = serviceAccount();
  if (!sa) return {};
  if (token && token.exp > Date.now() + 60_000) return { Authorization: `Bearer ${token.value}` };
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/drive.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  })}`;
  const signature = crypto.createSign('RSA-SHA256').update(unsigned).sign(sa.private_key, 'base64url');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${signature}` }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Google recusou a conta de servico: ${data.error_description || data.error}`);
  token = { value: data.access_token, exp: Date.now() + data.expires_in * 1000 };
  return { Authorization: `Bearer ${token.value}` };
}

async function driveFetch(url) {
  const u = new URL(url);
  if (!serviceAccount() && apiKey()) u.searchParams.set('key', apiKey());
  u.searchParams.set('supportsAllDrives', 'true');
  const res = await fetch(u, { headers: await authHeaders() });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const msg = data.error?.message || `HTTP ${res.status}`;
    if (res.status === 404) throw new Error('Pasta não encontrada ou sem acesso. Confira o link e o compartilhamento.');
    throw new Error(`Google Drive: ${msg}`);
  }
  return res;
}

async function listChildren(folderId) {
  const out = [];
  let pageToken = '';
  do {
    const q = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
    const fields = encodeURIComponent('nextPageToken, files(id, name, mimeType, size, createdTime, imageMediaMetadata(time))');
    const res = await driveFetch(`${API}/files?q=${q}&fields=${fields}&pageSize=1000&includeItemsFromAllDrives=true${pageToken ? `&pageToken=${pageToken}` : ''}`);
    const data = await res.json();
    out.push(...data.files);
    pageToken = data.nextPageToken || '';
  } while (pageToken);
  return out;
}

const isFolder = (f) => f.mimeType === 'application/vnd.google-apps.folder';

async function listImagesDeep(folderId, depth = 0) {
  const items = await listChildren(folderId);
  const files = items.filter((f) => !isFolder(f) && f.mimeType?.startsWith('image/'));
  if (depth < 3) {
    for (const sub of items.filter(isFolder)) files.push(...(await listImagesDeep(sub.id, depth + 1)));
  }
  return files;
}

export async function folderName(folderId) {
  const res = await driveFetch(`${API}/files/${folderId}?fields=id,name,mimeType`);
  const f = await res.json();
  if (!isFolder(f)) throw new Error('O link não é de uma pasta do Google Drive.');
  return f.name;
}

export function parseFolderId(link) {
  const s = String(link || '').trim();
  const m = s.match(/folders\/([a-zA-Z0-9_-]{10,})/) || s.match(/[?&]id=([a-zA-Z0-9_-]{10,})/) || s.match(/^([a-zA-Z0-9_-]{20,})$/);
  return m ? m[1] : null;
}

// "2026-09-12 Formatura CEJA - Criciuma" | "12-09-2026 Formatura" | "12.09 Arraial" -> { date, title, city }
export function parseEventName(name, year) {
  let rest = String(name).trim();
  let date = null;
  let m = rest.match(/^(\d{4})[-_. ](\d{1,2})[-_. ](\d{1,2})\s*[-–_]?\s*/);
  if (m) date = [m[1], m[2], m[3]];
  else if ((m = rest.match(/^(\d{1,2})[-_./](\d{1,2})[-_./](\d{2,4})\s*[-–_]?\s*/))) date = [m[3].length === 2 ? `20${m[3]}` : m[3], m[2], m[1]];
  else if ((m = rest.match(/^(\d{1,2})[-_./](\d{1,2})\s*[-–_]?\s*/))) date = [String(year), m[2], m[1]];
  if (m) rest = rest.slice(m[0].length);
  let iso = null;
  if (date) {
    const [y, mo, d] = date.map(Number);
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) iso = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  let city = null;
  const parts = rest.split(/\s+[-–]\s+/);
  if (parts.length > 1) city = parts.pop().trim();
  const title = parts.join(' - ').trim() || String(name).trim();
  return { date: iso, title, city };
}

// Data da foto (EXIF lido pelo Google) -> AAAA-MM-DD
function fileDate(files) {
  const times = files.map((f) => f.imageMediaMetadata?.time).filter(Boolean).sort();
  const t = times[0];
  if (t && /^\d{4}:\d{2}:\d{2}/.test(t)) return t.slice(0, 10).replace(/:/g, '-');
  return null;
}

async function eventForFolder(source, folder, files, isRoot) {
  const found = await db.one('select id, event_date from events where drive_folder_id = $1', [folder.id]);
  if (found) return found;
  const parsed = isRoot ? { title: `Fotos de ${source.year}`, date: `${source.year}-01-01`, city: null } : parseEventName(folder.name, source.year);
  const date = parsed.date || fileDate(files) || (folder.createdTime || '').slice(0, 10) || `${source.year}-01-01`;
  const slug = await uniqueSlug('events', `${parsed.title} ${date.slice(0, 4)}`);
  return db.one(
    `insert into events (slug, title, category_id, photographer_id, event_date, city, price_cents, pack_price_cents, status,
       hide_gallery, watermark_mode, drive_folder_id, drive_source_id, auto_publish)
     values ($1, $2, $3, $4, $5, $6, $7, $8, 'draft', $9, $10, $11, $12, $13) returning id, event_date`,
    [slug, parsed.title, source.category_id, source.photographer_id, date, parsed.city, source.price_cents, source.pack_price_cents,
      source.hide_gallery, source.watermark_mode, folder.id, source.id, source.auto_publish],
  );
}

async function skip(source, file, reason) {
  await db.query(
    'insert into drive_skips (drive_file_id, source_id, name, reason) values ($1, $2, $3, $4) on conflict (drive_file_id) do nothing',
    [file.id, source.id, file.name, reason],
  );
}

// Revisao automatica de cada arquivo: formato, arquivo inteiro, resolucao minima e repeticao.
async function importFile(source, event, file) {
  if (!IMAGE_TYPES.has(file.mimeType)) {
    await skip(source, file, `formato não suportado (${file.mimeType.replace('image/', '')})`);
    return 'skip';
  }
  const tmp = path.join(dirs.tmp, `drive-${file.id}`);
  try {
    const res = await driveFetch(`${API}/files/${file.id}?alt=media`);
    await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(tmp));
    let meta;
    try {
      meta = await sharp(tmp).metadata();
    } catch {
      await skip(source, file, 'arquivo corrompido');
      return 'skip';
    }
    if (Math.min(meta.width || 0, meta.height || 0) < MIN_SIDE) {
      await skip(source, file, `resolução baixa (${meta.width}x${meta.height})`);
      return 'skip';
    }
    const sha = await fileSha(tmp);
    const dup = await db.one('select id from photos where event_id = $1 and sha256 = $2', [event.id, sha]);
    if (dup) {
      await skip(source, file, 'foto repetida');
      return 'skip';
    }
    const photo = await db.one(
      `insert into photos (event_id, photographer_id, original_name, original_path, sort_key, drive_file_id) values ($1, $2, $3, '', $4, $5) returning id`,
      [event.id, source.photographer_id, file.name, file.name, file.id],
    );
    try {
      const stored = await saveOriginal({ tmpPath: tmp, eventId: event.id, photoId: photo.id, originalName: file.name, sha256: sha });
      const key = await renderPhoto({ eventId: event.id, photoId: photo.id, originalPath: stored.originalPath });
      await db.query(
        `update photos set original_path = $2, width = $3, height = $4, bytes = $5, sha256 = $6, key = $7, needs_faces = true where id = $1`,
        [photo.id, stored.originalPath, stored.width, stored.height, stored.bytes, stored.sha256, key],
      );
    } catch (err) {
      await db.query('delete from photos where id = $1', [photo.id]);
      throw err;
    }
    return 'ok';
  } finally {
    await fsp.unlink(tmp).catch(() => {});
  }
}

export async function syncSource(sourceId) {
  const source = await db.one('select * from drive_sources where id = $1', [sourceId]);
  if (!source) return;
  await db.query(`update drive_sources set last_status = 'sincronizando', last_error = null where id = $1`, [source.id]);
  let imported = 0;
  let skipped = 0;
  let errors = 0;
  let remaining = 0;
  try {
    const root = await listChildren(source.folder_id);
    const groups = [{ folder: { id: source.folder_id, name: source.name }, files: root.filter((f) => !isFolder(f) && f.mimeType?.startsWith('image/')), isRoot: true }];
    for (const sub of root.filter(isFolder).sort((a, b) => a.name.localeCompare(b.name))) {
      groups.push({ folder: sub, files: await listImagesDeep(sub.id), isRoot: false });
    }
    const known = new Set((await db.many(
      `select drive_file_id from photos where drive_file_id is not null union select drive_file_id from drive_skips where source_id = $1`,
      [source.id],
    )).map((r) => r.drive_file_id));
    let budget = FILES_PER_RUN;
    for (const g of groups) {
      const fresh = g.files.filter((f) => !known.has(f.id)).sort((a, b) => a.name.localeCompare(b.name, 'pt', { numeric: true }));
      if (!fresh.length) continue;
      if (budget <= 0) {
        remaining += fresh.length;
        continue;
      }
      const event = await eventForFolder(source, g.folder, g.files, g.isRoot);
      for (const file of fresh) {
        if (budget <= 0) {
          remaining++;
          continue;
        }
        budget--;
        try {
          (await importFile(source, event, file)) === 'ok' ? imported++ : skipped++;
        } catch (err) {
          errors++;
          console.error('[drive]', file.name, err.message);
        }
      }
    }
    const status = remaining
      ? `continuando: ${imported} importadas agora, faltam ${remaining}`
      : `ok: ${imported} novas, ${skipped} recusadas${errors ? `, ${errors} com erro` : ''}`;
    // Com arquivos faltando, last_sync_at nao avanca: a proxima rodada continua logo em seguida.
    await db.query(
      `update drive_sources set last_status = $2, last_sync_at = case when $3 then last_sync_at else now() end where id = $1`,
      [source.id, status, remaining > 0],
    );
  } catch (err) {
    console.error('[drive] fonte', source.id, err.message);
    await db.query(`update drive_sources set last_status = 'erro', last_error = $2, last_sync_at = now() where id = $1`, [source.id, err.message]);
  }
  return { imported, skipped, errors, remaining };
}

// Chamado pela fila quando nao ha outro trabalho: sincroniza uma pasta vencida por vez.
export async function syncDueSources() {
  if (!driveInfo().configured) return;
  const due = await db.one(
    `select id from drive_sources where active
       and (last_sync_at is null or last_sync_at < now() - make_interval(mins => $1) or last_status like 'continuando%' or last_status = 'na fila')
     order by last_sync_at nulls first limit 1`,
    [SYNC_MINUTES],
  );
  if (due) await syncSource(due.id);
}
