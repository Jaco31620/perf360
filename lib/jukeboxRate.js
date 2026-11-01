/*
 * Jukebox — limites de débit (anti-abus) : compteur atomique en base
 * (fonction SQL jukebox_hit, v22). tooMany(clé, max, fenêtre en s) → true si
 * la limite est dépassée. Sans la fonction (SQL pas encore appliqué) ou en cas
 * d'erreur : jamais bloquant.
 */
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export async function tooMany(key, max, windowSec) {
  try {
    const { data, error } = await getSupabaseAdmin().rpc("jukebox_hit", { p_key: key, p_window_s: windowSec });
    if (error) { console.warn("jukebox rate:", error.message); return false; }
    return Number(data) > max;
  } catch (e) {
    return false;
  }
}

/* Adresse du client (Vercel), pour les limites par appareil. */
export const clientIp = (req) => (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "?";

/* Compteurs expirés (appelé par la purge quotidienne). */
export async function purgeRate() {
  await getSupabaseAdmin().from("jukebox_rate").delete().lt("until", new Date(Date.now() - 86400e3).toISOString());
}
