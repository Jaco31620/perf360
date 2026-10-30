"use client";
/*
 * Chargement unique de l'API IFrame YouTube (partagé régie / écran).
 * createPlayer(container, options) crée le lecteur dans un élément ajouté
 * hors de React : le lecteur remplace cet élément par son iframe, sans
 * sous-titres automatiques.
 */

let apiPromise = null;

export function loadYouTubeApi() {
  if (typeof window === "undefined") return Promise.reject(new Error("navigateur requis"));
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (!apiPromise) {
    apiPromise = new Promise((resolve) => {
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => { prev?.(); resolve(window.YT); };
      if (!document.getElementById("yt-iframe-api")) {
        const s = document.createElement("script");
        s.id = "yt-iframe-api";
        s.src = "https://www.youtube.com/iframe_api";
        document.body.appendChild(s);
      }
    });
  }
  return apiPromise;
}

/* Sous-titres automatiques coupés : cc_load_policy ne suffit pas (le choix
 * de l'utilisateur YouTube l'emporte), on décharge aussi le module à chaque
 * lancement de vidéo. Annotations masquées (iv_load_policy). */
function noCaptions(p) {
  try { p.unloadModule("captions"); p.unloadModule("cc"); } catch (e) { /* lecteur pas prêt */ }
}

export function createPlayer(container, options) {
  const el = document.createElement("div");
  container.appendChild(el);
  const events = options.events || {};
  return new window.YT.Player(el, {
    width: "100%", height: "100%", ...options,
    playerVars: { cc_load_policy: 0, iv_load_policy: 3, ...options.playerVars },
    events: {
      ...events,
      onStateChange: (e) => {
        if (e.data === 1 || e.data === 3) noCaptions(e.target);
        events.onStateChange?.(e);
      },
    },
  });
}
