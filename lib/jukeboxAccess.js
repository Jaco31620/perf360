/*
 * Jukebox — accès régie.
 *  - Code régie à 6 chiffres par soirée (jukebox_sessions.regie_code) : tapé
 *    sur /jukebox/<code>/regie ou /telecommande, il ouvre l'accès à
 *    l'appareil. 5 essais ratés : bloqué 10 minutes.
 *  - Chaque appareil reçoit son propre jeton (table jukebox_devices, seul le
 *    hachage est gardé) : liste des appareils en régie, retrait un par un.
 *  - Passe à usage unique (QR « Ajouter un appareil », valable 10 min),
 *    rangé dans jukebox_config (« join:<passe> »).
 *  - Ancien jeton unique (admin_hash, liens #t=…) : toujours accepté, et
 *    enregistré comme appareil à sa première utilisation.
 */
import { tooMany } from "@/lib/jukeboxRate";
import { createHash, randomBytes, randomInt, timingSafeEqual } from "crypto";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { isJukeboxSuper } from "@/lib/jukeboxAdmin";

const MAX_FAILS = 5;
const LOCK_MS = 10 * 60e3;
const PASS_TTL = 10 * 60e3;

const sha = (t) => createHash("sha256").update(String(t)).digest("hex");
const sameHash = (token, hash) => {
  if (!token || !hash) return false;
  const a = Buffer.from(sha(token));
  const b = Buffer.from(hash);
  return a.length === b.length && timingSafeEqual(a, b);
};
export const newRegieCode = () => String(randomInt(0, 1e6)).padStart(6, "0");
const newToken = () => randomBytes(24).toString("hex");

/* « iPhone · Safari », « PC Windows · Chrome », « Télé Samsung »… */
export function deviceLabel(ua = "") {
  const dev = /SMART-TV|Tizen/i.test(ua) ? "Télé Samsung" : /Web0S|webOS/i.test(ua) ? "Télé LG" : /AFT|Silk/i.test(ua) ? "Fire TV"
    : /Android TV|GoogleTV|CrKey/i.test(ua) ? "Google TV" : /iPhone/i.test(ua) ? "iPhone" : /iPad/i.test(ua) ? "iPad"
    : /Android/i.test(ua) ? (/Mobile/i.test(ua) ? "Téléphone Android" : "Tablette Android")
    : /Windows/i.test(ua) ? "PC Windows" : /Macintosh/i.test(ua) ? "Mac" : /Linux/i.test(ua) ? "PC Linux" : "Appareil";
  const nav = /Edg\//.test(ua) ? "Edge" : /SamsungBrowser/.test(ua) ? "Samsung Internet" : /Firefox\//.test(ua) ? "Firefox"
    : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "";
  return nav && !dev.startsWith("Télé") ? `${dev} · ${nav}` : dev;
}

/* Nouvel appareil autorisé : renvoie son jeton (gardé par l'appareil). */
export async function createDevice(sessionId, label) {
  const token = newToken();
  const { error } = await getSupabaseAdmin().from("jukebox_devices")
    .insert({ session_id: sessionId, token_hash: sha(token), label: String(label || "Appareil").slice(0, 80) });
  if (error) throw error;
  return token;
}

/* Droits régie d'une requête : { ok, deviceId } (super-admin : deviceId null). */
export async function adminAccess(req, s) {
  const token = req.headers.get("x-jukebox-admin");
  if (token && /^[a-f0-9]{16,128}$/.test(token)) {
    const sb = getSupabaseAdmin();
    const hash = sha(token);
    const { data: dev } = await sb.from("jukebox_devices").select("id,last_seen").eq("session_id", s.id).eq("token_hash", hash).maybeSingle();
    if (dev) {
      if (Date.now() - Date.parse(dev.last_seen) > 60e3) await sb.from("jukebox_devices").update({ last_seen: new Date().toISOString() }).eq("id", dev.id);
      return { ok: true, deviceId: dev.id };
    }
    if (sameHash(token, s.admin_hash)) { // ancien jeton unique : enregistré comme appareil
      const { data: row } = await sb.from("jukebox_devices")
        .insert({ session_id: s.id, token_hash: hash, label: deviceLabel(req.headers.get("user-agent") || "") }).select("id").maybeSingle();
      return { ok: true, deviceId: row?.id || null };
    }
  }
  return { ok: isJukeboxSuper(req), deviceId: null };
}

/* Code régie de la soirée (créé pour les soirées d'avant le code). */
export async function ensureRegieCode(s) {
  if (s.regie_code) return s.regie_code;
  const code = newRegieCode();
  await getSupabaseAdmin().from("jukebox_sessions").update({ regie_code: code }).eq("id", s.id);
  s.regie_code = code;
  return code;
}

/* Code régie tapé sur un appareil : { token } ou { error, status }. */
export async function joinWithCode(s, pin, ua) {
  const sb = getSupabaseAdmin();
  // compteur atomique : des essais envoyés en parallèle comptent tous
  if (await tooMany(`pin:${s.id}`, 15, 600))
    return { error: "Trop d'essais : réessayez dans quelques minutes.", status: 429 };
  if (s.regie_locked_until && Date.parse(s.regie_locked_until) > Date.now())
    return { error: "Trop d'essais : réessayez dans quelques minutes.", status: 429 };
  const good = await ensureRegieCode(s);
  if (String(pin || "").replace(/\D/g, "") !== good) {
    const fails = (s.regie_fails || 0) + 1;
    await sb.from("jukebox_sessions").update(fails >= MAX_FAILS
      ? { regie_fails: 0, regie_locked_until: new Date(Date.now() + LOCK_MS).toISOString() }
      : { regie_fails: fails }).eq("id", s.id);
    return { error: fails >= MAX_FAILS ? "Trop d'essais : réessayez dans 10 minutes." : "Code régie incorrect.", status: 403 };
  }
  if (s.regie_fails) await sb.from("jukebox_sessions").update({ regie_fails: 0 }).eq("id", s.id);
  return { token: await createDevice(s.id, deviceLabel(ua)) };
}

/* Passe à usage unique (QR « Ajouter un appareil »). */
export async function createJoinPass(s) {
  const pass = newToken().slice(0, 32);
  const { error } = await getSupabaseAdmin().from("jukebox_config")
    .upsert({ key: `join:${pass}`, value: JSON.stringify({ sid: s.id, at: Date.now() }) });
  if (error) throw error;
  return pass;
}
export async function joinWithPass(s, pass, ua, label) {
  if (!/^[a-f0-9]{32}$/.test(String(pass || ""))) return { error: "Lien invalide.", status: 400 };
  const sb = getSupabaseAdmin();
  // lu et effacé d'un coup : deux appareils ne peuvent pas utiliser le même passe
  const { data: rows } = await sb.from("jukebox_config").delete().eq("key", `join:${pass}`).select("value");
  const data = rows?.[0];
  if (!data) return { error: "Ce QR code a déjà servi ou a expiré : demandez-en un nouveau.", status: 410 };
  let v = null;
  try { v = JSON.parse(data.value); } catch (e) { /* illisible */ }
  if (!v || v.sid !== s.id || Date.now() - v.at > PASS_TTL) return { error: "Ce QR code a expiré : demandez-en un nouveau.", status: 410 };
  return { token: await createDevice(s.id, label || deviceLabel(ua)) };
}

/* Appareils autorisés (le plus récent d'abord). */
export async function listDevices(s, currentId) {
  const { data, error } = await getSupabaseAdmin().from("jukebox_devices")
    .select("id,label,created_at,last_seen").eq("session_id", s.id).order("last_seen", { ascending: false });
  if (error) throw error;
  return data.map((d) => ({ id: d.id, label: d.label, createdAt: d.created_at, lastSeen: d.last_seen, me: d.id === currentId }));
}

/* Retrait d'un appareil (son jeton ne vaut plus rien). */
export async function revokeDevice(s, id) {
  const sb = getSupabaseAdmin();
  const { data: dev } = await sb.from("jukebox_devices").select("token_hash").eq("session_id", s.id).eq("id", String(id || "")).maybeSingle();
  if (!dev) return;
  await sb.from("jukebox_devices").delete().eq("id", id);
  if (dev.token_hash === s.admin_hash) await sb.from("jukebox_sessions").update({ admin_hash: sha(newToken()) }).eq("id", s.id); // ancien jeton unique
}

/* Nouveau code régie ; logoutAll : tous les appareils déconnectés. */
export async function resetRegieCode(s, logoutAll) {
  const sb = getSupabaseAdmin();
  const code = newRegieCode();
  const patch = { regie_code: code, regie_fails: 0, regie_locked_until: null, ...(logoutAll ? { admin_hash: sha(newToken()) } : {}) };
  const { error } = await sb.from("jukebox_sessions").update(patch).eq("id", s.id);
  if (error) throw error;
  if (logoutAll) await sb.from("jukebox_devices").delete().eq("session_id", s.id);
  return code;
}
