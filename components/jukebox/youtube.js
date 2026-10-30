"use client";
/*
 * Chargement unique de l'API IFrame YouTube (partagé régie / écran).
 * createPlayer(container, options) crée le lecteur dans un élément ajouté
 * hors de React : le lecteur remplace cet élément par son iframe.
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

export function createPlayer(container, options) {
  const el = document.createElement("div");
  container.appendChild(el);
  return new window.YT.Player(el, { width: "100%", height: "100%", ...options });
}
