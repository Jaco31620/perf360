/*
 * Jukebox — codes d'activation individuels (SERVEUR uniquement, table
 * jukebox_activations, SQL v19). En mode de création « Avec un code », chaque
 * organisateur reçoit son propre code : nombre de soirées autorisées (null =
 * illimité), date d'expiration facultative, désactivable à tout moment ; les
 * soirées créées avec un code reçoivent ses fonctions et le nom de
 * l'organisateur (options.organizer).
 */
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { normalizeFeatures, cleanValid } from "@/lib/jukebox";

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // sans 0/O, 1/I/L
export const MAX_LABEL_LEN = 60;

/* Saisie libre (minuscules, espaces, tirets) → forme rangée en base « ABCD-EFGH ». */
export function normalizeActCode(s) {
  const raw = String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return raw.length === 8 ? `${raw.slice(0, 4)}-${raw.slice(4)}` : raw;
}
function newActCode() {
  const b = crypto.getRandomValues(new Uint8Array(8));
  return normalizeActCode(Array.from(b, (x) => ALPHABET[x % ALPHABET.length]).join(""));
}
const cleanMax = (v) => (v == null || v === "" ? null : Math.max(1, Math.min(999, parseInt(v, 10) || 1)));
const cleanDate = (v) => {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};

/* État d'un code : actif, épuisé, expiré ou désactivé. */
export function activationStatus(a, now = Date.now()) {
  if (a.revoked_at) return "revoked";
  if (a.expires_at && Date.parse(a.expires_at) <= now) return "expired";
  if (a.max_parties != null && a.used >= a.max_parties) return "spent";
  return "active";
}

function out(a) {
  return {
    id: a.id,
    code: a.code,
    label: a.label,
    maxParties: a.max_parties,
    used: a.used,
    expiresAt: a.expires_at,
    revoked: !!a.revoked_at,
    features: a.features ? normalizeFeatures(a.features) : null, // null : fonctions par défaut
    validDays: cleanValid(a.retention_days), // durée d'utilisation des soirées créées (colonne v24 retention_days ; null : sans limite)
    createdAt: a.created_at,
    lastUsedAt: a.last_used_at,
    status: activationStatus(a),
  };
}

export async function listActivations() {
  const { data, error } = await getSupabaseAdmin().from("jukebox_activations")
    .select("*").order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []).map(out);
}

export async function createActivation({ label, maxParties = 1, expiresAt = null, features = null, validDays = null }) {
  const name = String(label || "").trim().slice(0, MAX_LABEL_LEN);
  if (!name) throw new ActivationError("Indiquez le nom de l'organisateur.");
  const sb = getSupabaseAdmin();
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data, error } = await sb.from("jukebox_activations").insert({
      code: newActCode(), label: name, max_parties: cleanMax(maxParties), expires_at: cleanDate(expiresAt),
      features: features && typeof features === "object" ? normalizeFeatures(features) : null,
      ...(cleanValid(validDays) ? { retention_days: cleanValid(validDays) } : {}), // colonne v24
    }).select("*").maybeSingle();
    if (!error) return out(data);
    if (error.code !== "23505") throw error;
  }
  throw new Error("Impossible de générer un code.");
}

export async function updateActivation(id, patch) {
  const row = {};
  if (typeof patch.label === "string" && patch.label.trim()) row.label = patch.label.trim().slice(0, MAX_LABEL_LEN);
  if ("maxParties" in patch) row.max_parties = cleanMax(patch.maxParties);
  if ("expiresAt" in patch) row.expires_at = cleanDate(patch.expiresAt);
  if ("revoked" in patch) row.revoked_at = patch.revoked ? new Date().toISOString() : null;
  if ("features" in patch) row.features = patch.features && typeof patch.features === "object" ? normalizeFeatures(patch.features) : null;
  if ("resetUsed" in patch && patch.resetUsed) row.used = 0;
  if ("validDays" in patch) row.retention_days = cleanValid(patch.validDays);
  if (!Object.keys(row).length) return;
  const { error } = await getSupabaseAdmin().from("jukebox_activations").update(row).eq("id", id);
  if (error) throw error;
}

export async function deleteActivation(id) {
  const { error } = await getSupabaseAdmin().from("jukebox_activations").delete().eq("id", id);
  if (error) throw error;
}

export class ActivationError extends Error {}

const MESSAGES = {
  unknown: "Code d'activation inconnu.",
  revoked: "Ce code d'activation a été désactivé.",
  expired: "Ce code d'activation a expiré.",
  spent: "Ce code d'activation a déjà servi pour toutes ses soirées.",
};

async function findActivation(code) {
  const c = normalizeActCode(code);
  if (!c) return null;
  const { data, error } = await getSupabaseAdmin().from("jukebox_activations").select("*").eq("code", c).maybeSingle();
  if (error) throw error;
  return data;
}

/* Vérification sans consommer (accueil : « Bonjour Max, 1 soirée restante »). */
export async function checkActivation(code) {
  const a = await findActivation(code);
  if (!a) return { ok: false, error: MESSAGES.unknown };
  const st = activationStatus(a);
  if (st !== "active") return { ok: false, error: MESSAGES[st] };
  return { ok: true, label: a.label, remaining: a.max_parties == null ? null : a.max_parties - a.used };
}

/* Réserve une soirée sur le code (compteur incrémenté sans course :
 * mise à jour conditionnée à l'ancienne valeur). Lève ActivationError. */
export async function consumeActivation(code) {
  const sb = getSupabaseAdmin();
  for (let attempt = 0; attempt < 4; attempt++) {
    const a = await findActivation(code);
    if (!a) throw new ActivationError(MESSAGES.unknown);
    const st = activationStatus(a);
    if (st !== "active") throw new ActivationError(MESSAGES[st]);
    const { data, error } = await sb.from("jukebox_activations")
      .update({ used: a.used + 1, last_used_at: new Date().toISOString() })
      .eq("id", a.id).eq("used", a.used).select("id");
    if (error) throw error;
    if (data?.length) return out({ ...a, used: a.used + 1 });
  }
  throw new ActivationError("Code très sollicité, réessayez.");
}

/* Création de la soirée ratée après réservation : on rend la soirée au code. */
export async function refundActivation(id) {
  const sb = getSupabaseAdmin();
  const { data } = await sb.from("jukebox_activations").select("used").eq("id", id).maybeSingle();
  if (data?.used > 0) await sb.from("jukebox_activations").update({ used: data.used - 1 }).eq("id", id).eq("used", data.used);
}
