/*
 * Jukebox — temps réel (SERVEUR) : après chaque changement, un signal
 * « quelque chose a changé » est diffusé par Supabase Realtime (Broadcast,
 * API REST) ; les écrans abonnés relisent aussitôt l'état par les routes
 * habituelles (rien de confidentiel ne transite par le canal).
 *  - canal principal `jukebox:<code>` : file, soirée, blind test (tout le monde) ;
 *  - canal de contrôle `jukebox:<code>:ctl` : position de lecture et ordres
 *    de la télécommande, réponses du blind test (régie, écran, télécommande seulement : envoyés
 *    toutes les 5 s, inutile de réveiller les téléphones des invités).
 * Jamais bloquant : un échec laisse les écrans sur leur relecture périodique.
 */
const TIMEOUT_MS = 1500;

export const liveTopic = (code, ctl = false) => `jukebox:${code}${ctl ? ":ctl" : ""}`;

export async function notify(code, kind = "queue") {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || !code) return;
  const ctl = kind === "playback" || kind === "command" || kind === "answer";
  try {
    await fetch(`${url}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ topic: liveTopic(code, ctl), event: "changed", payload: { t: kind, at: Date.now() } }] }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (e) {
    console.warn("jukebox live:", e?.message || e);
  }
}
