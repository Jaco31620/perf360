"use client";
/*
 * Empêche l'écran de se mettre en veille (Screen Wake Lock) tant que `on` :
 * télécommande, régie, écran d'affichage, téléphone d'un invité pendant le
 * blind test. Le verrou saute quand la page est masquée : il est repris au
 * retour. Sans effet sur les navigateurs qui ne le proposent pas.
 */
import { useEffect } from "react";

export function useWakeLock(on = true) {
  useEffect(() => {
    if (!on || typeof navigator === "undefined" || !navigator.wakeLock) return;
    let lock = null;
    let stopped = false;
    const take = async () => {
      if (stopped || document.visibilityState !== "visible" || lock) return;
      try {
        lock = await navigator.wakeLock.request("screen");
        lock.addEventListener("release", () => { lock = null; });
      } catch (e) { /* refusé (économie d'énergie…) : tant pis */ }
    };
    take();
    document.addEventListener("visibilitychange", take);
    // certains navigateurs exigent un geste de l'utilisateur : on retente au premier toucher
    window.addEventListener("pointerdown", take);
    return () => {
      stopped = true;
      document.removeEventListener("visibilitychange", take);
      window.removeEventListener("pointerdown", take);
      lock?.release().catch(() => {});
    };
  }, [on]);
}
