/*
 * Clic-Clac — helpers SERVEUR (route handlers uniquement).
 *  - Authentification : mot de passe super-admin (scrypt, en base) et code admin
 *    d'album (SHA-256, en base) → jetons signés HMAC (en-tête x-cc-auth).
 *    Portées : "super" (tout), "album:<id>" (organisateur), "booth:<id>" (borne).
 *  - Stockage : bucket PRIVÉ « clicclac », liens signés temporaires.
 *    Toutes les opérations Storage passent par ce module (changer de fournisseur
 *    plus tard = ne modifier qu'ici).
 */
import crypto from "node:crypto";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { normalizeSettings, isAlbumCode, normalizeCode, CODE_ALPHABET } from "./settings";

export const BUCKET = "clicclac";
const HOUR = 3600 * 1000;

/* ── Jetons ─────────────────────────────────────────────────────── */
function secret() {
  const k = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!k) throw new Error("SUPABASE_SERVICE_ROLE_KEY manquant.");
  return crypto.createHash("sha256").update("clicclac-auth|" + k).digest();
}
const b64url = (b) => Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

export function signToken(scope, ttlMs = 12 * HOUR) {
  const body = b64url(JSON.stringify({ scope, exp: Date.now() + ttlMs }));
  return `${body}.${b64url(crypto.createHmac("sha256", secret()).update(body).digest())}`;
}

export function verifyToken(token) {
  if (!token || typeof token !== "string" || !token.includes(".")) return null;
  const [body, sig] = token.split(".");
  const good = b64url(crypto.createHmac("sha256", secret()).update(body).digest());
  if (sig.length !== good.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return null;
  try {
    const p = JSON.parse(Buffer.from(body.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString());
    return p.exp > Date.now() ? p : null;
  } catch (e) {
    return null;
  }
}

const tokenOf = (req) => verifyToken(req.headers.get("x-cc-auth"));
export const isSuper = (req) => tokenOf(req)?.scope === "super";

/* Rôle du demandeur pour un album : "super" | "admin" | "booth" | null. */
export function roleFor(req, album) {
  const scope = tokenOf(req)?.scope;
  if (scope === "super") return "super";
  if (scope === `album:${album.id}`) return "admin";
  if (scope === `booth:${album.id}`) return "booth";
  return null;
}
export const canAdmin = (role) => role === "super" || role === "admin";

/* ── Mots de passe ──────────────────────────────────────────────── */
export async function checkMasterPassword(pw) {
  const { data, error } = await getSupabaseAdmin().from("clicclac_config").select("master_hash").eq("id", 1).maybeSingle();
  if (error) throw error;
  const [, salt, hash] = String(data?.master_hash || "").split("$");
  if (!salt || !hash || typeof pw !== "string" || !pw) return false;
  const test = crypto.scryptSync(pw, salt, 64);
  const ref = Buffer.from(hash, "hex");
  return ref.length === test.length && crypto.timingSafeEqual(ref, test);
}

export const sha256 = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");
export function checkPin(pin, hash) {
  if (!pin || !hash) return false;
  const a = Buffer.from(sha256(String(pin).toUpperCase().trim())), b = Buffer.from(hash);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function randomCode(len) {
  const bytes = crypto.randomBytes(len);
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

/* ── Albums ─────────────────────────────────────────────────────── */
export async function loadAlbum(code) {
  const c = normalizeCode(code);
  if (!isAlbumCode(c)) return null;
  const { data, error } = await getSupabaseAdmin().from("clicclac_albums").select("*").eq("code", c).maybeSingle();
  if (error) throw error;
  return data ? { ...data, settings: normalizeSettings(data.settings) } : null;
}

/* Date d'expiration = fin du jour de l'événement + durée de conservation. */
export function computeExpiry(eventDate, retentionDays) {
  const base = eventDate ? new Date(`${eventDate}T23:59:59Z`) : new Date();
  return new Date(base.getTime() + retentionDays * 24 * HOUR).toISOString();
}

export async function albumUsage(albumId) {
  const { data, error } = await getSupabaseAdmin().from("clicclac_photos").select("bytes,status").eq("album_id", albumId);
  if (error) throw error;
  return {
    photos: data.length,
    pending: data.filter((p) => p.status === "pending").length,
    bytes: data.reduce((s, p) => s + (p.bytes || 0), 0),
  };
}

/* Informations publiques d'un album (invités). */
export async function publicAlbum(a) {
  const s = a.settings;
  const customFrameUrl = s.customFrame ? (await signUrls([s.customFrame]))[0] : null;
  return {
    code: a.code,
    name: a.name,
    eventDate: a.event_date,
    expiresAt: a.expires_at,
    settings: {
      guestQuota: s.guestQuota, moderation: s.moderation, maxPhotos: s.maxPhotos,
      framesMode: s.framesMode, frames: s.frames, imposedFrame: s.imposedFrame,
      filtersMode: s.filtersMode, filters: s.filters, imposedFilter: s.imposedFilter,
      stripEnabled: s.stripEnabled, guestDownload: s.guestDownload, keepHd: s.keepHd,
      hasCustomFrame: !!s.customFrame,
    },
    customFrameUrl,
  };
}

/* ── Stockage ───────────────────────────────────────────────────── */
export async function putFile(path, buffer, contentType) {
  const { error } = await getSupabaseAdmin().storage.from(BUCKET).upload(path, buffer, { contentType, upsert: true, cacheControl: "3600" });
  if (error) throw error;
}

export async function removeFiles(paths) {
  const list = paths.filter(Boolean);
  for (let i = 0; i < list.length; i += 900) {
    const { error } = await getSupabaseAdmin().storage.from(BUCKET).remove(list.slice(i, i + 900));
    if (error) throw error;
  }
}

/* Liens signés (1 h par défaut), dans l'ordre des chemins demandés. */
export async function signUrls(paths, ttlSec = 3600) {
  if (!paths.length) return [];
  const { data, error } = await getSupabaseAdmin().storage.from(BUCKET).createSignedUrls(paths, ttlSec);
  if (error) throw error;
  const map = new Map(data.map((d) => [d.path, d.signedUrl]));
  return paths.map((p) => map.get(p) || null);
}

/* Supprime un album : fichiers puis lignes (les photos suivent en cascade). */
export async function deleteAlbum(album) {
  const sb = getSupabaseAdmin();
  const { data: photos } = await sb.from("clicclac_photos").select("path,thumb_path,hd_path").eq("album_id", album.id);
  const files = (photos || []).flatMap((p) => [p.path, p.thumb_path, p.hd_path]);
  if (album.settings?.customFrame) files.push(album.settings.customFrame);
  await removeFiles(files);
  const { error } = await sb.from("clicclac_albums").delete().eq("id", album.id);
  if (error) throw error;
}

/* Vérifie la signature binaire d'un JPEG / PNG. */
export function sniffImage(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  return null;
}
