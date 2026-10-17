"use client";
/*
 * Nuage de mots — écran présentateur (à projeter). Rafraîchit le nuage toutes
 * les 2 s. Avec le jeton présentateur (localStorage, ou #t=… dans l'URL pour
 * ouvrir la session sur un autre appareil) : ouvrir/fermer les envois, masquer
 * un mot d'un clic, choisir le style (palette + fond), modifier la question,
 * réinitialiser, supprimer.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import WordCloud from "./WordCloud";
import { getAdminToken, setAdminToken, rememberCloud, forgetCloud, formatCode } from "./storage";
import { MAX_QUESTION_LEN } from "@/lib/nuage";
import { PALETTES, BACKGROUNDS, normalizeStyle, resolveTheme } from "@/lib/nuageThemes";

export default function Presenter({ code }) {
  const router = useRouter();
  const [data, setData] = useState(null);
  const [missing, setMissing] = useState(false);
  const [styleOverride, setStyleOverride] = useState(null); // choix local en attente / non enregistré
  const [stylePanel, setStylePanel] = useState(false);
  const [bigQr, setBigQr] = useState(false);
  const [settings, setSettings] = useState(false);
  const [origin, setOrigin] = useState("");
  const token = useRef(null);

  useEffect(() => {
    const m = window.location.hash.match(/t=([a-f0-9]+)/);
    if (m) {
      setAdminToken(code, m[1]);
      history.replaceState(null, "", window.location.pathname);
    }
    token.current = getAdminToken(code);
    setOrigin(window.location.origin);
    try {
      const saved = localStorage.getItem(`nuage_style_${code}`);
      if (saved) setStyleOverride(normalizeStyle(JSON.parse(saved)));
    } catch (e) { /* ignoré */ }
  }, [code]);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/nuage/${code}`, {
        cache: "no-store",
        headers: token.current ? { "x-nuage-admin": token.current } : {},
      });
      if (res.status === 404) return setMissing(true);
      if (res.ok) {
        const d = await res.json();
        setData(d);
        if (d.admin) rememberCloud(code, d.session.question);
      }
    } catch (e) { /* réseau : on retentera */ }
  }, [code]);

  useEffect(() => {
    refresh();
    const id = setInterval(() => { if (!document.hidden) refresh(); }, 2000);
    return () => clearInterval(id);
  }, [refresh]);

  const act = async (action, extra = {}, silent = false) => {
    const res = await fetch(`/api/nuage/${code}/admin`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-nuage-admin": token.current || "" },
      body: JSON.stringify({ action, ...extra }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { if (!silent) alert(d.error || "Action impossible."); return false; }
    await refresh();
    return true;
  };

  // Appliqué tout de suite à l'écran, gardé en local, et enregistré sur le nuage
  // (pour la vue « nuage en direct » des participants et les autres appareils).
  const changeStyle = (patch) => {
    const next = normalizeStyle({ ...style, ...patch });
    setStyleOverride(next);
    try { localStorage.setItem(`nuage_style_${code}`, JSON.stringify(next)); } catch (e) { /* ignoré */ }
    act("style", { style: next }, true);
  };

  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else document.documentElement.requestFullscreen?.();
  };

  const hideWord = (w) => {
    if (confirm(`Masquer « ${w.text} » du nuage ?`)) act("hide", { key: w.k });
  };

  if (missing) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-slate-900 text-white">
        <p className="text-xl">Ce nuage n'existe pas (ou a été supprimé).</p>
        <Link href="/nuage" className="bg-white text-slate-900 font-bold px-6 py-3 rounded-full">Retour</Link>
      </div>
    );
  }

  const s = data?.session;
  const style = normalizeStyle(styleOverride || s?.style);
  const t = resolveTheme(style);
  const isAdmin = !!data?.admin;
  const joinUrl = `${origin}/nuage/${code}`;
  const host = origin.replace(/^https?:\/\//, "");
  const btn = "px-3.5 py-2 rounded-full text-sm font-semibold transition-colors";

  return (
    <div className="h-[100dvh] flex flex-col overflow-hidden" style={{ background: t.bg, color: t.fg }}>
      {/* En-tête : question + comment rejoindre */}
      <header className="flex items-start gap-6 px-6 sm:px-10 pt-6">
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl sm:text-4xl font-extrabold leading-tight">{s?.question || "…"}</h1>
          {s && s.status !== "open" && <p className="mt-2 text-sm font-semibold" style={{ color: t.sub }}>🔒 Envois fermés</p>}
        </div>
        <button onClick={() => setBigQr(true)} className="hidden sm:flex items-center gap-4 rounded-2xl p-3 shrink-0 text-left" style={{ background: t.panel }}>
          <div className="text-sm leading-snug">
            <div style={{ color: t.sub }}>Rendez-vous sur</div>
            <div className="font-bold">{host}/nuage</div>
            <div className="mt-1" style={{ color: t.sub }}>avec le code</div>
            <div className="text-2xl font-black tracking-wider">{formatCode(code)}</div>
          </div>
          {origin && <div className="bg-white p-1.5 rounded-lg"><QRCodeSVG value={joinUrl} size={96} fgColor="#0f172a" /></div>}
        </button>
      </header>

      {/* Nuage */}
      <main className="flex-1 min-h-0 px-4 sm:px-8 py-4">
        {data && data.words.length > 0 ? (
          <WordCloud words={data.words} colors={t.colors} onWordClick={isAdmin ? hideWord : undefined} />
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-center gap-3" style={{ color: t.sub }}>
            <p className="text-xl">En attente des premiers mots…</p>
            <p className="text-sm sm:hidden">Code : <b>{formatCode(code)}</b></p>
          </div>
        )}
      </main>

      {/* Barre du bas */}
      <footer className="flex flex-wrap items-center gap-2 px-6 sm:px-10 pb-5 text-sm">
        <span style={{ color: t.sub }}>
          {data ? `${data.participants} participant${data.participants > 1 ? "s" : ""} · ${data.total} mot${data.total > 1 ? "s" : ""}` : ""}
        </span>
        <div className="flex-1" />
        {isAdmin && s && (
          <button onClick={() => act(s.status === "open" ? "close" : "open")} className={btn} style={{ background: t.panel }}>
            {s.status === "open" ? "⏸ Fermer les envois" : "▶ Ouvrir les envois"}
          </button>
        )}
        <button onClick={() => setBigQr(true)} className={btn} style={{ background: t.panel }}>QR code</button>
        {isAdmin && <button onClick={() => setStylePanel(true)} className={btn} style={{ background: t.panel }}>🎨 Style</button>}
        <button onClick={toggleFullscreen} className={btn} style={{ background: t.panel }}>⛶</button>
        {isAdmin && <button onClick={() => setSettings(true)} className={btn} style={{ background: t.panel }}>⚙️</button>}
      </footer>

      {bigQr && (
        <div onClick={() => setBigQr(false)} className="fixed inset-0 z-40 flex flex-col items-center justify-center gap-6 bg-black/85 text-white cursor-pointer p-6 text-center">
          <div className="bg-white p-5 rounded-3xl"><QRCodeSVG value={joinUrl} size={320} /></div>
          <p className="text-2xl">Rendez-vous sur <b>{host}/nuage</b></p>
          <p className="text-6xl font-black tracking-widest">{formatCode(code)}</p>
        </div>
      )}

      {stylePanel && isAdmin && (
        <StylePanel style={style} onChange={changeStyle} onClose={() => setStylePanel(false)} />
      )}

      {settings && isAdmin && s && (
        <Settings
          session={s} hidden={data.hidden || []} code={code} token={token.current} origin={origin}
          onClose={() => setSettings(false)} act={act}
          onDeleted={() => { forgetCloud(code); router.push("/nuage"); }}
        />
      )}
    </div>
  );
}

function StylePanel({ style, onChange, onClose }) {
  const isPreset = BACKGROUNDS.some((b) => b.value === style.bg);
  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="w-full max-w-sm h-full bg-white text-gray-900 overflow-y-auto p-6 space-y-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold">Style</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl">✕</button>
        </div>
        <p className="text-xs text-gray-400 -mt-4">Les changements s'appliquent en direct. Les couleurs des mots s'adaptent au fond pour rester lisibles.</p>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-gray-600">Fond</h3>
          <div className="grid grid-cols-6 gap-2">
            {BACKGROUNDS.map((b) => (
              <button key={b.value} title={b.label} onClick={() => onChange({ bg: b.value })}
                className={`aspect-square rounded-xl border-2 ${style.bg === b.value ? "border-violet-600 ring-2 ring-violet-300" : "border-gray-200"}`}
                style={{ background: b.value }} />
            ))}
          </div>
          <label className="flex items-center gap-3 text-sm text-gray-600 pt-1">
            <input type="color" value={style.bg} onChange={(e) => onChange({ bg: e.target.value })}
              className="w-10 h-10 rounded-lg border-2 border-gray-200 cursor-pointer" />
            <span>Couleur personnalisée{!isPreset && <b className="ml-1 font-mono">{style.bg}</b>}</span>
          </label>
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-gray-600">Couleurs des mots</h3>
          {Object.entries(PALETTES).map(([key, p]) => {
            const preview = resolveTheme({ palette: key, bg: style.bg });
            const active = style.palette === key;
            return (
              <button key={key} onClick={() => onChange({ palette: key })}
                className={`w-full flex items-center gap-3 rounded-2xl px-3 py-2.5 border-2 text-left ${active ? "border-violet-600" : "border-transparent hover:border-gray-200"}`}
                style={{ background: preview.bg }}>
                <span className="flex-1 font-extrabold truncate" style={{ color: preview.fg }}>{p.label}</span>
                <span className="flex gap-1">
                  {preview.colors.map((c, i) => <span key={i} className="w-4 h-4 rounded-full" style={{ background: c }} />)}
                </span>
              </button>
            );
          })}
        </section>
      </div>
    </div>
  );
}

function Settings({ session, hidden, code, token, origin, onClose, act, onDeleted }) {
  const [question, setQuestion] = useState(session.question);
  const [copied, setCopied] = useState(false);

  const copyPresenterLink = async () => {
    try {
      await navigator.clipboard.writeText(`${origin}/nuage/${code}/presenter#t=${token}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) { /* ignoré */ }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex justify-end" onClick={onClose}>
      <div className="w-full max-w-sm h-full bg-white text-gray-900 overflow-y-auto p-6 space-y-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold">Réglages</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl">✕</button>
        </div>

        <section className="space-y-2">
          <label className="text-sm font-semibold text-gray-600">Question</label>
          <textarea rows={3} maxLength={MAX_QUESTION_LEN} value={question} onChange={(e) => setQuestion(e.target.value)}
            className="w-full border-2 border-gray-200 rounded-xl px-3 py-2 focus:border-violet-500 outline-none resize-none" />
          <button disabled={!question.trim() || question === session.question} onClick={() => act("question", { question })}
            className="bg-violet-600 disabled:opacity-40 text-white text-sm font-bold px-4 py-2 rounded-full">Enregistrer</button>
        </section>

        <section className="flex items-center justify-between">
          <label className="text-sm font-semibold text-gray-600">Mots par participant</label>
          <select value={session.maxPerParticipant} onChange={(e) => act("max", { max: e.target.value })}
            className="border-2 border-gray-200 rounded-xl px-3 py-1.5 font-semibold">
            {[1, 2, 3, 4, 5, 10].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-gray-600">Mots masqués ({hidden.length})</h3>
          <p className="text-xs text-gray-400">Astuce : cliquez sur un mot du nuage pour le masquer.</p>
          {hidden.map((w) => (
            <div key={w.k} className="flex items-center justify-between bg-gray-50 rounded-xl px-3 py-2 text-sm">
              <span>{w.w} <span className="text-gray-400">×{w.n}</span></span>
              <button onClick={() => act("unhide", { key: w.k })} className="text-sky-600 font-semibold">Réafficher</button>
            </div>
          ))}
        </section>

        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-gray-600">Présenter depuis un autre appareil</h3>
          <button onClick={copyPresenterLink} className="w-full border-2 border-gray-200 rounded-full py-2 text-sm font-semibold hover:bg-gray-50">
            {copied ? "✓ Lien copié" : "Copier le lien présentateur"}
          </button>
          <p className="text-xs text-gray-400">Ce lien donne le contrôle du nuage : ne le partagez pas avec le public.</p>
        </section>

        <section className="space-y-2 pt-4 border-t border-gray-100">
          <button onClick={() => confirm("Effacer tous les mots envoyés ?") && act("reset")}
            className="w-full border-2 border-orange-200 text-orange-600 rounded-full py-2 text-sm font-semibold hover:bg-orange-50">
            Réinitialiser le nuage
          </button>
          <button onClick={async () => confirm("Supprimer définitivement ce nuage ?") && (await act("delete")) && onDeleted()}
            className="w-full border-2 border-red-200 text-red-600 rounded-full py-2 text-sm font-semibold hover:bg-red-50">
            Supprimer le nuage
          </button>
        </section>
      </div>
    </div>
  );
}
