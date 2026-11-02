"use client";
/*
 * Temps réel côté écran : abonnement aux signaux « quelque chose a changé »
 * de la soirée (Supabase Realtime, canal public sans données, voir
 * lib/jukeboxLive.js) → relecture immédiate de l'état. La relecture
 * périodique reste en filet de sécurité : lente quand le canal est connecté
 * (`slow`), à l'ancienne cadence sinon (`fast` : canal bloqué, réseau
 * capricieux). `ctl` : aussi le canal de contrôle (position de lecture,
 * ordres de la télécommande, réponses du blind test).
 */
import { useEffect, useRef, useState } from "react";
import { createClient } from "@supabase/supabase-js";

let client = null;
function rt() {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return client;
}

export function useLive(code, refresh, { ctl = false, fast, slow, enabled = true, hiddenPause = false }) {
  const [live, setLive] = useState(false);
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  // abonnement : chaque signal → relecture (regroupée : rafale = une seule relecture)
  useEffect(() => {
    if (!enabled || !code) return;
    const sb = rt();
    if (!sb) return;
    let timer = null;
    const ping = () => {
      if (timer) return;
      timer = setTimeout(() => { timer = null; refreshRef.current(); }, 120);
    };
    const subs = [`jukebox:${code}`, ...(ctl ? [`jukebox:${code}:ctl`] : [])].map((topic) => {
      const ch = sb.channel(topic, { config: { broadcast: { self: false } } });
      ch.on("broadcast", { event: "changed" }, ping);
      return ch;
    });
    const ok = new Set();
    subs.forEach((ch, i) => ch.subscribe((status) => {
      if (status === "SUBSCRIBED") { ok.add(i); if (ok.size === subs.length) { setLive(true); ping(); } }
      else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") { ok.delete(i); setLive(false); }
    }));
    return () => { clearTimeout(timer); setLive(false); subs.forEach((ch) => sb.removeChannel(ch)); };
  }, [code, ctl, enabled]);

  // relecture périodique : filet de sécurité
  const every = live ? slow : fast;
  useEffect(() => {
    if (!enabled || !every) return;
    const id = setInterval(() => { if (!hiddenPause || !document.hidden) refreshRef.current(); }, every);
    return () => clearInterval(id);
  }, [every, enabled, hiddenPause]);

  return live;
}
