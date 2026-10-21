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
import { detectFacesOnServer } from './facepool.js';
import { encodeDescriptor, invalidateFaces } from './faces.js';
import { activity, count, progress } from './activity.js';

// Importacao do Google Drive. Dois tipos de pasta ligada:
//   kind 'year' (pasta geral: um ano so, ou a raiz 'tudoehfesta' com 2003..2026 dentro):
//     2026/                                <- pasta ligada no painel
//       10/                                <- pasta so de organizacao (mes): sem fotos, nao vira evento
//         aniversario_luiz_05_10_2026/     <- tem fotos: vira o evento "Aniversario Luiz", 05/10/2026
//       foto-solta.jpg                     <- vai para o evento "Fotos de 2026"
//   kind 'event' (pasta especifica ligada a um evento ja cadastrado, ex.: uma formatura):
//     todas as fotos da pasta (e subpastas) entram naquele evento. Se a pasta do ano passar pela mesma
//     pasta, reaproveita o evento (drive_folder_id) e nao duplica fotos (drive_file_id).
// Acesso: conta de servico (GOOGLE_SERVICE_ACCOUNT_JSON; a pasta fica privada, compartilhada com o e-mail
// da conta) ou chave de API (GOOGLE_API_KEY; a pasta precisa estar como "qualquer pessoa com o link").

const API = 'https://www.googleapis.com/drive/v3';
export const SYNC_MINUTES = Math.max(2, Number(process.env.DRIVE_SYNC_MINUTES) || 10);
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

export async function downloadDriveFile(fileId, dest) {
  const res = await driveFetch(`${API}/files/${fileId}?alt=media`);
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(dest));
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

const SMALL_WORDS = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'em', 'na', 'no', 'a', 'o']);

// Nome todo em minusculas (ex.: "aniversario luiz") ganha maiusculas; nomes ja escritos com cuidado ficam como estao.
function prettyTitle(text) {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t !== t.toLowerCase()) return t;
  return t.split(' ').map((w, i) => (i > 0 && SMALL_WORDS.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1))).join(' ');
}

const isoDate = (y, mo, d) => {
  [y, mo, d] = [y, mo, d].map(Number);
  if (y < 100) y += 2000;
  if (!(mo >= 1 && mo <= 12 && d >= 1 && d <= 31 && y >= 1990 && y <= 2100)) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
};

// Le data, titulo e cidade do nome da pasta. Aceita a data no comeco ou no fim, com - . / _ ou espaco:
//   "aniversario_luiz_05_10_2026"           -> Aniversario Luiz, 2026-10-05
//   "formatura_futurao_20_10_2026"          -> Formatura Futurao, 2026-10-20
//   "2026-09-12 Formatura CEJA - Criciuma"  -> Formatura CEJA, 2026-09-12, Criciuma
//   "12.09 Arraial"                         -> Arraial, <ano>-09-12
export function parseEventName(name, year) {
  let rest = String(name).replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  let date = null;
  let m;
  if ((m = rest.match(/^(\d{4})[-. /](\d{1,2})[-. /](\d{1,2})(?:\s*[-–]\s*|\s+|$)/))) {
    date = isoDate(m[1], m[2], m[3]);
  } else if ((m = rest.match(/^(\d{1,2})[-. /](\d{1,2})[-. /](\d{4}|\d{2})(?:\s*[-–]\s*|\s+|$)/))) {
    date = isoDate(m[3], m[2], m[1]);
  } else if ((m = rest.match(/(?:^|\s)(\d{1,2})[-. /](\d{1,2})[-. /](\d{4})\s*$/))) {
    date = isoDate(m[3], m[2], m[1]);
  } else if ((m = rest.match(/^(\d{1,2})[-./](\d{1,2})(?:\s*[-–]\s*|\s+)/))) {
    date = isoDate(year, m[2], m[1]);
  }
  if (m && date) rest = (rest.slice(0, m.index) + ' ' + rest.slice(m.index + m[0].length)).trim();
  let city = null;
  const parts = rest.split(/\s+[-–]\s+/);
  if (parts.length > 1) city = parts.pop().trim();
  const title = prettyTitle(parts.join(' - ').replace(/\s*[-–]\s*$/, '')) || prettyTitle(String(name).replace(/_/g, ' '));
  return { date, title, city: city ? prettyTitle(city) : null };
}

// Data da foto (EXIF lido pelo Google) -> AAAA-MM-DD
function fileDate(files) {
  const times = files.map((f) => f.imageMediaMetadata?.time).filter(Boolean).sort();
  const t = times[0];
  if (t && /^\d{4}:\d{2}:\d{2}/.test(t)) return t.slice(0, 10).replace(/:/g, '-');
  return null;
}

// "2026 / 10 / evento": pastas de ano e mes servem so para organizar e ajudam a datar o evento.
function dateFromPath(pathNames) {
  let y = null;
  let mo = null;
  for (const n of pathNames) {
    const s = String(n).trim();
    if (/^\d{4}$/.test(s)) y = Number(s);
    else if (/^\d{1,2}$/.test(s) && Number(s) >= 1 && Number(s) <= 12) mo = Number(s);
    else {
      const lead = s.match(/^(\d{1,2})\s*[-_. ]/);
      if (lead && Number(lead[1]) >= 1 && Number(lead[1]) <= 12) mo = Number(lead[1]);
    }
  }
  return y && mo ? isoDate(y, mo, 1) : null;
}

const isImage = (f) => !isFolder(f) && f.mimeType?.startsWith('image/');

// Percorre a pasta do ano: toda pasta que tem fotos vira um evento (com as fotos das subpastas dela);
// pastas sem fotos (ano, mes) so organizam. Fotos soltas na raiz vao para "Fotos de <ano>".
async function collectGroups(source) {
  if (source.kind === 'event') {
    return [{ folder: { id: source.folder_id, name: source.name }, files: await listImagesDeep(source.folder_id), path: [], isRoot: false, eventId: source.event_id }];
  }
  const groups = [];
  async function walk(folder, path, depth) {
    const items = await listChildren(folder.id);
    const images = items.filter(isImage);
    const subs = items.filter(isFolder).sort((a, b) => a.name.localeCompare(b.name, 'pt', { numeric: true }));
    // Raiz, ano ("2026") e mes ("10") so organizam: fotos soltas nelas viram um grupo proprio,
    // mas as subpastas continuam sendo eventos separados.
    const organizer = depth === 0 || /^\d{4}$/.test(String(folder.name).trim()) || /^\d{1,2}$/.test(String(folder.name).trim());
    if (organizer) {
      if (images.length) groups.push({ folder, files: images, path, isRoot: depth === 0 });
    } else if (images.length) {
      const files = [...images];
      for (const s of subs) files.push(...(await listImagesDeep(s.id, depth + 1)));
      groups.push({ folder, files, path, isRoot: false });
      return;
    }
    if (depth < 5) for (const s of subs) await walk(s, [...path, folder.name], depth + 1);
  }
  await walk({ id: source.folder_id, name: source.name }, [], 0);
  return groups;
}

const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

// Titulo e data de uma pasta que tem fotos. Pastas de ano ou de mes com fotos soltas viram
// "Eventos de 2008" / "Fotos de outubro de 2026"; as demais tem o nome lido como evento.
function describeGroup(source, g) {
  const name = String(g.folder.name).trim();
  const pathDate = dateFromPath([...g.path, name]);
  const yearInPath = [...g.path, name].map((n) => String(n).trim()).filter((n) => /^\d{4}$/.test(n)).pop();
  if (g.isRoot) {
    const y = source.year || yearInPath;
    return { title: y ? `Fotos de ${y}` : 'Fotos avulsas', date: y ? `${y}-01-01` : null, city: null };
  }
  if (/^\d{4}$/.test(name)) return { title: `Eventos de ${name}`, date: `${name}-01-01`, city: null };
  if (/^\d{1,2}$/.test(name) && Number(name) >= 1 && Number(name) <= 12 && yearInPath) {
    return { title: `Fotos de ${MONTHS[Number(name) - 1]} de ${yearInPath}`, date: pathDate, city: null };
  }
  const parsed = parseEventName(name, source.year || Number(yearInPath) || new Date().getFullYear());
  return { ...parsed, date: parsed.date || pathDate };
}

async function eventForGroup(source, g) {
  if (g.eventId) {
    const ev = await db.one('select id, event_date from events where id = $1', [g.eventId]);
    if (ev) return { ...ev, tag: g.folder.name };
  }
  const folderPath = [...g.path, g.folder.name].join(' / ');
  const found = await db.one('select id, event_date from events where drive_folder_id = $1', [g.folder.id]);
  if (found) {
    await db.query('update events set drive_folder_path = $2 where id = $1 and drive_folder_path is distinct from $2', [found.id, folderPath]);
    await db.query('update photos set tag = $2 where event_id = $1 and tag is null and drive_file_id is not null', [found.id, g.folder.name]);
    return { ...found, tag: g.folder.name };
  }
  const parsed = describeGroup(source, g);
  const date = parsed.date || fileDate(g.files) || (g.folder.createdTime || '').slice(0, 10) || new Date().toISOString().slice(0, 10);
  const slug = await uniqueSlug('events', `${parsed.title} ${date.slice(0, 4)}`);
  return db.one(
    `insert into events (slug, title, category_id, photographer_id, event_date, city, price_cents, pack_price_cents, status,
       hide_gallery, watermark_mode, drive_folder_id, drive_source_id, auto_publish, kind, drive_folder_path)
     values ($1, $2, $3, $4, $5, $6, $7, $8, 'draft', $9, $10, $11, $12, $13, 'pool', $14) returning id, event_date`,
    [slug, parsed.title, source.category_id, source.photographer_id, date, parsed.city, source.price_cents, source.pack_price_cents,
      source.hide_gallery, source.watermark_mode, g.folder.id, source.id, source.auto_publish, folderPath],
  ).then((ev) => {
    activity('pasta', `Nova pasta no acervo: ${folderPath}`);
    return { ...ev, tag: g.folder.name };
  });
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
    await downloadDriveFile(file.id, tmp);
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
      `insert into photos (event_id, photographer_id, original_name, original_path, sort_key, drive_file_id, tag) values ($1, $2, $3, '', $4, $5, $6) returning id`,
      [event.id, source.photographer_id, file.name, file.name, file.id, event.tag || null],
    );
    try {
      if (source.keep_in_drive) {
        // Original continua so no Drive: gera vitrine e rostos agora, enquanto o arquivo esta baixado.
        const { size } = await fsp.stat(tmp);
        const rotated = meta.orientation && meta.orientation >= 5;
        const key = await renderPhoto({ eventId: event.id, photoId: photo.id, srcFile: tmp });
        let faces = [];
        try {
          faces = await detectFacesOnServer(tmp);
        } catch (err) {
          console.error('[drive] rostos', file.name, err.message);
        }
        const year = Number(String(event.event_date).slice(0, 4));
        for (const f of faces.slice(0, 60)) {
          const buf = encodeDescriptor(f.d);
          if (buf) await db.query('insert into faces (photo_id, event_id, year, descriptor, box) values ($1, $2, $3, $4, $5::jsonb)', [photo.id, event.id, year, buf, JSON.stringify(f.box)]);
        }
        await db.query(
          `update photos set original_path = $2, width = $3, height = $4, bytes = $5, sha256 = $6, key = $7, faces_count = $8 where id = $1`,
          [photo.id, `drive:${file.id}`, rotated ? meta.height : meta.width, rotated ? meta.width : meta.height, size, sha, key, faces.length],
        );
        if (faces.length) invalidateFaces();
      } else {
        const stored = await saveOriginal({ tmpPath: tmp, eventId: event.id, photoId: photo.id, originalName: file.name, sha256: sha });
        const key = await renderPhoto({ eventId: event.id, photoId: photo.id, originalPath: stored.originalPath });
        await db.query(
          `update photos set original_path = $2, width = $3, height = $4, bytes = $5, sha256 = $6, key = $7, needs_faces = true where id = $1`,
          [photo.id, stored.originalPath, stored.width, stored.height, stored.bytes, stored.sha256, key],
        );
      }
    } catch (err) {
      await db.query('delete from photos where id = $1', [photo.id]);
      throw err;
    }
    return 'ok';
  } finally {
    await fsp.unlink(tmp).catch(() => {});
  }
}

// Previa do que a sincronizacao enxerga, sem importar nada: o que esta na raiz e quais pastas viram eventos.
export async function previewSource(source) {
  const top = await listChildren(source.folder_id);
  const groups = await collectGroups(source);
  const imported = new Set((await db.many('select drive_file_id from photos where drive_file_id is not null')).map((r) => r.drive_file_id));
  return {
    root: top.map((f) => ({ name: f.name, type: isFolder(f) ? 'pasta' : f.mimeType })).slice(0, 100),
    events: groups.map((g) => {
      const d = describeGroup(source, g);
      const supported = g.files.filter((f) => IMAGE_TYPES.has(f.mimeType));
      return {
        folder: [...g.path, g.folder.name].join(' / '),
        title: d.title,
        date: d.date,
        photos: supported.length,
        unsupported: g.files.length - supported.length,
        imported: g.files.filter((f) => imported.has(f.id)).length,
      };
    }),
  };
}

export async function syncSource(sourceId) {
  const source = await db.one('select * from drive_sources where id = $1', [sourceId]);
  if (!source) return;
  await db.query(`update drive_sources set last_status = 'sincronizando', last_error = null where id = $1`, [source.id]);
  progress.sync = { source: source.name, started: Date.now(), phase: 'lendo as pastas do Drive', total: 0, done: 0, imported: 0, skipped: 0, folder: null };
  let imported = 0;
  let skipped = 0;
  let errors = 0;
  let remaining = 0;
  try {
    // Importacao cortada no meio (servidor reiniciado durante um deploy) deixa a foto sem original:
    // apaga para o arquivo ser importado de novo nesta rodada.
    await db.query(`delete from photos where original_path = '' and drive_file_id is not null and created_at < now() - interval '10 minutes'`);
    const groups = await collectGroups(source);
    const known = new Set((await db.many(
      `select drive_file_id from photos where drive_file_id is not null union select drive_file_id from drive_skips where source_id = $1`,
      [source.id],
    )).map((r) => r.drive_file_id));
    let budget = FILES_PER_RUN;
    const pendingAll = groups.reduce((n, g) => n + g.files.filter((f) => !known.has(f.id)).length, 0);
    progress.sync = { ...progress.sync, phase: 'importando', total: Math.min(pendingAll, FILES_PER_RUN), pending_all: pendingAll };
    if (pendingAll) activity('drive', `"${source.name}": ${pendingAll} fotos novas encontradas no Drive`);
    for (const g of groups) {
      const fresh = g.files.filter((f) => !known.has(f.id)).sort((a, b) => a.name.localeCompare(b.name, 'pt', { numeric: true }));
      if (!fresh.length) continue;
      if (budget <= 0) {
        remaining += fresh.length;
        continue;
      }
      const event = await eventForGroup(source, g);
      const folderPath = [...g.path, g.folder.name].join(' / ');
      progress.sync.folder = folderPath;
      const before = imported;
      for (const file of fresh) {
        if (budget <= 0) {
          remaining++;
          continue;
        }
        budget--;
        try {
          if ((await importFile(source, event, file)) === 'ok') {
            imported++;
            count('import');
          } else {
            skipped++;
            count('skip');
          }
        } catch (err) {
          errors++;
          console.error('[drive]', file.name, err.message);
          activity('erro', `Drive: ${file.name}: ${err.message}`);
        }
        Object.assign(progress.sync, { done: progress.sync.done + 1, imported, skipped });
      }
      if (imported > before) activity('import', `+${imported - before} fotos de ${folderPath}`);
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
    activity('erro', `Drive "${source.name}": ${err.message}`);
    await db.query(`update drive_sources set last_status = 'erro', last_error = $2, last_sync_at = now() where id = $1`, [source.id, err.message]);
  }
  progress.sync = null;
  if (imported || skipped || errors) {
    activity('drive', `"${source.name}": ${imported} importadas, ${skipped} recusadas${errors ? `, ${errors} com erro` : ''}${remaining ? `, faltam ${remaining}` : ''}`);
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
