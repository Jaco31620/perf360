"use client";
/*
 * Synchronisation d'horloge avec le serveur, façon NTP : 6 allers-retours vers
 * /api/laure50/time, on garde l'échantillon au plus petit aller-retour ;
 * offset = heure serveur − milieu de l'aller-retour. Resynchro toutes les 30 s
 * (lissage 70/30) et immédiatement (sans lissage) au retour d'arrière-plan.
 * serverNow() = Date.now() + offset.
 */

async function measure() {
  let best = null;
  for (let i = 0; i < 6; i++) {
    try {
      const t0 = Date.now();
      const res = await fetch("/api/laure50/time", { cache: "no-store" });
      const { t } = await res.json();
      const t1 = Date.now();
      const rtt = t1 - t0;
      if (!best || rtt < best.rtt) best = { rtt, offset: t - (t0 + t1) / 2 };
    } catch (e) { /* échantillon perdu */ }
  }
  return best;
}

export function startClock() {
  const clock = { offset: 0, rtt: null, synced: false };
  let stopped = false;

  const sync = async (smooth) => {
    const m = await measure();
    if (!m || stopped) return;
    clock.offset = smooth && clock.synced ? clock.offset * 0.7 + m.offset * 0.3 : m.offset;
    clock.rtt = m.rtt;
    clock.synced = true;
  };

  sync(false);
  const timer = setInterval(() => sync(true), 30000);
  const onVis = () => { if (document.visibilityState === "visible") sync(false); };
  document.addEventListener("visibilitychange", onVis);

  clock.now = () => Date.now() + clock.offset;
  clock.stop = () => {
    stopped = true;
    clearInterval(timer);
    document.removeEventListener("visibilitychange", onVis);
  };
  return clock;
}
