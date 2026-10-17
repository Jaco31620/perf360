/*
 * Nuage de mots — helpers SERVEUR (à n'importer que depuis les route handlers).
 * Jeton présentateur : chaîne aléatoire remise au créateur ; seul son SHA-256
 * est stocké en base.
 */
import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { isValidCode } from "@/lib/nuage";

export const newAdminToken = () => randomBytes(24).toString("hex");
export const hashToken = (t) => createHash("sha256").update(String(t)).digest("hex");

export function checkToken(token, hash) {
  if (!token || !hash) return false;
  const a = Buffer.from(hashToken(token));
  const b = Buffer.from(hash);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function loadSession(code) {
  if (!isValidCode(code)) return null;
  const { data, error } = await getSupabaseAdmin()
    .from("nuage_sessions").select("*").eq("code", code).maybeSingle();
  if (error) throw error;
  return data;
}

export const publicSession = (s) => ({
  code: s.code,
  question: s.question,
  status: s.status,
  maxPerParticipant: s.max_per_participant,
});
