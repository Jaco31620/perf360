"use client";
/*
 * File « 🔗 Ajoutés par lien » : vidéos ajoutées par lien YouTube en soirée,
 * absentes de la mémoire. Ajouter à la mémoire (fiche Deezer choisie à la
 * main, version paroles / clip / karaoké, validée) ou ignorer.
 */
import { useCallback, useEffect, useState } from "react";
import { getSuperToken } from "../storage";
import { VideoPreview, PreviewThumb } from "../Controls";
import { formatDuration, SEARCH_MODES, REPORT_REASONS } from "@/lib/jukebox";
import { cleanTitle, splitVideoTitle } from "@/lib/jukeboxBlind";
import { backdropClose } from "@/lib/backdrop";
import { modeLabel } from "./shared";

const REASON_LABEL = Object.fromEntries(REPORT_REASONS.map((r) => [r.id, r.label]));

export function LinkQueue({ call, onChanged }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [preview, setPreview] = useState(null);
  const [adding, setAdding] = useState(null);
  const [review, setReview] = useState(null); // { items, start } : liste figée pendant la revue
  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/jukebox/super?links=1", { cache: "no-store", headers: { "x-jukebox-super": getSuperToken() || "" } });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Chargement impossible.");
      setData(d);
      setErr("");
    } catch (e) { setErr(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const drop = (videoId) => setData((d) => d && { total: d.total - 1, items: d.items.filter((x) => x.videoId !== videoId) });
  const ignore = async (it, keep = false) => {
    if (!keep) drop(it.videoId);
    try { await call("POST", { action: "ignoreLink", videoId: it.videoId }); onChanged?.(); } catch (e) { alert(e.message); load(); }
  };

  if (err) return <p className="text-sm text-red-600">{err}</p>;
  if (!data) return <p className="text-sm text-gray-400">Chargement…</p>;
  if (!data.items.length) return <p className="text-sm text-gray-400">Aucune vidéo ajoutée par lien hors mémoire 👍</p>;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={() => { setPreview(null); setReview({ items: data.items, start: 0 }); }}
          className="text-sm font-bold text-white bg-fuchsia-600 hover:bg-fuchsia-700 px-5 py-2 rounded-full">▶ Commencer ({data.items.length})</button>
        {data.total > data.items.length && <span className="text-xs text-gray-400">{data.items.length} plus récentes sur {data.total}.</span>}
      </div>
      <ul className="space-y-2">
        {data.items.map((it) => (
          <li key={it.videoId} className="border border-gray-200 rounded-2xl p-2.5 space-y-2">
            <div className="flex flex-wrap items-center gap-3">
              <PreviewThumb videoId={it.videoId} active={preview === it.videoId} onClick={() => setPreview(preview === it.videoId ? null : it.videoId)} />
              <div className="flex-1 min-w-[180px]">
                <p className="text-sm font-bold text-gray-900 leading-snug select-text">{it.videoTitle || it.title}</p>
                <p className="text-xs text-gray-500">
                  {[it.channel, formatDuration(it.duration), it.sessionName && `soirée « ${it.sessionName} »`, new Date(it.at).toLocaleDateString("fr-FR"), it.times > 1 && `ajoutée ${it.times} fois`].filter(Boolean).join(" · ")}
                </p>
                {it.reports.map((r, k) => (
                  <p key={k} className="text-xs text-red-700 mt-0.5">🚩 {r.reasons.map((x) => REASON_LABEL[x] || x).join(" · ")}{r.comment && <i> — « {r.comment} »</i>}</p>
                ))}
              </div>
              <div className="flex flex-wrap gap-1.5 shrink-0">
                <button onClick={() => setAdding(it)} className="text-xs font-bold text-white bg-fuchsia-600 px-3 py-1.5 rounded-full">➕ Ajouter à la mémoire</button>
                <button onClick={() => ignore(it)} title="Pas une chanson, ou sans intérêt : ne revient plus" className="text-xs font-bold text-gray-600 bg-gray-100 px-3 py-1.5 rounded-full">✕ Ignorer</button>
              </div>
            </div>
            {preview === it.videoId && <div className="max-w-xl"><VideoPreview videoId={it.videoId} onClose={() => setPreview(null)} /></div>}
          </li>
        ))}
      </ul>
      {review && <LinkReview items={review.items} start={review.start} call={call}
        onDone={() => onChanged?.()} onIgnore={(it) => ignore(it, true)} onClose={() => { setReview(null); load(); }} />}
      {adding && <LinkAddChooser item={adding} call={call} onClose={() => setAdding(null)}
        onDone={() => { drop(adding.videoId); setAdding(null); onChanged?.(); }} />}
    </div>
  );
}

/* Version devinée d'après le titre de la vidéo. */
const guessKind = (t) => (/karaok/i.test(t) ? "karaoke" : /lyric|parole/i.test(t) ? "normal" : /official\s+(music\s+)?video|clip\s+officiel|videoclip/i.test(t) ? "clip" : "normal");

function LinkAddChooser({ item, call, onClose, onDone }) {
  const [busy, setBusy] = useState(false);
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-3" {...backdropClose(() => !busy && onClose())}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-lg max-h-[90vh] overflow-y-auto bg-white rounded-3xl p-5 space-y-3 shadow-2xl">
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold uppercase tracking-wider text-fuchsia-600">Ajouter à la mémoire</p>
            <p className="font-bold leading-snug">{item.videoTitle || item.title}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none" aria-label="Fermer">×</button>
        </div>
        <LinkAddPanel item={item} call={call} onDone={onDone} onBusy={setBusy} />
      </div>
    </div>
  );
}

/* Choix de la version et de la chanson (fiche Deezer), dans la fenêtre ou la revue. */
function LinkAddPanel({ item, call, onDone, onBusy }) {
  const raw = item.videoTitle || item.title || "";
  const parts = splitVideoTitle(raw, item.channel);
  const [q, setQ] = useState(`${parts.artist || ""} ${cleanTitle(parts.title || raw)}`.replace(/\s+/g, " ").trim());
  const [kind, setKind] = useState(guessKind(raw));
  const [list, setList] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusyState] = useState(false);
  const setBusy = (b) => { setBusyState(b); onBusy?.(b); };
  const search = async (e) => {
    e?.preventDefault();
    setError("");
    setList(null);
    try { setList((await call("POST", { action: "deezerSearch", q })).results || []); } catch (err) { setError(err.message); setList([]); }
  };
  useEffect(() => { search(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const choose = async (t, replace = false) => {
    setBusy(true);
    setError("");
    try {
      const d = await call("POST", { action: "addLink", videoId: item.videoId, deezerId: t.deezerId, kind, replace });
      if (d.conflict) {
        setBusy(false);
        if (confirm(`« ${t.channel} – ${t.title} » a déjà une version ${modeLabel(kind)}${d.conflict.validated ? " validée" : ""} avec une autre vidéo${d.conflict.title ? ` (« ${d.conflict.title} »)` : ""}.\n\nLa remplacer par celle-ci ?`)) return choose(t, true);
        return;
      }
      setBusy(false);
      onDone();
    } catch (err) { setError(err.message); setBusy(false); }
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-gray-500">Cette vidéo est la version</span>
        <div className="flex bg-gray-100 rounded-full p-0.5">
          {SEARCH_MODES.map((m) => (
            <button key={m.id} onClick={() => setKind(m.id)} className={`px-3 py-1 rounded-full font-bold ${kind === m.id ? "bg-fuchsia-600 text-white" : "text-gray-600"}`}>{m.label}</button>
          ))}
        </div>
      </div>
      <p className="text-xs text-gray-500">Choisissez la chanson (fiche Deezer) : la vidéo devient sa version {modeLabel(kind)}, validée. Si la chanson est déjà en mémoire, elle la rejoint.</p>
      <form onSubmit={search} className="flex gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Artiste et titre"
          className="flex-1 border-2 border-gray-200 rounded-full px-4 py-1.5 text-sm focus:border-fuchsia-500 outline-none" />
        <button className="text-sm font-bold text-white bg-fuchsia-600 px-4 py-1.5 rounded-full">Chercher</button>
      </form>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {list === null ? <p className="text-sm text-gray-400">Recherche…</p> : list.length === 0 ? <p className="text-sm text-gray-400">Aucun résultat.</p> : (
        <ul className="divide-y divide-gray-100 max-h-72 overflow-y-auto">
          {list.map((t) => (
            <li key={t.id}>
              <button disabled={busy} onClick={() => choose(t)} className="w-full flex items-center gap-3 py-2 text-left hover:bg-fuchsia-50 rounded-xl px-1 disabled:opacity-60">
                {t.thumb ? <img src={t.thumb} alt="" className="w-10 h-10 rounded-lg object-cover shrink-0" /> : <span className="w-10 h-10 rounded-lg bg-gray-100 shrink-0" />}
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-semibold truncate">{t.title}</span>
                  <span className="block text-xs text-gray-500 truncate">{t.channel} · {formatDuration(t.duration)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* Revue : une vidéo à la fois — lecture, ajout à la mémoire (version + chanson) ou ignorer. */
function LinkReview({ items, start, call, onDone, onIgnore, onClose }) {
  const [i, setI] = useState(start);
  const it = items[i];
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const next = () => setI((x) => x + 1);
  return (
    <div className="fixed inset-0 z-40 bg-black/70 flex items-center justify-center p-2 sm:p-3" {...backdropClose(onClose)}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-6xl max-h-[97vh] flex flex-col bg-white rounded-3xl p-4 gap-3 shadow-2xl">
        <div className="flex items-center gap-3 shrink-0">
          <p className="text-xs font-bold uppercase tracking-wider text-fuchsia-600 whitespace-nowrap">🔗 Ajoutés par lien · {Math.min(i + 1, items.length)} / {items.length}</p>
          <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full bg-fuchsia-500 transition-all" style={{ width: `${(Math.min(i, items.length) / items.length) * 100}%` }} />
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-2xl leading-none" aria-label="Fermer">×</button>
        </div>
        {!it ? (
          <div className="text-center py-10 space-y-3">
            <p className="text-3xl">🎉</p>
            <p className="font-bold">Terminé</p>
            <button onClick={onClose} className="text-sm font-bold text-white bg-fuchsia-600 px-4 py-2 rounded-full">Fermer</button>
          </div>
        ) : (
          <div className="flex-1 min-h-0 overflow-y-auto grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(320px,1fr)] items-start">
            <div className="mx-auto w-full" style={{ maxWidth: "calc((97vh - 200px) * 16 / 9)" }}>
              <VideoPreview videoId={it.videoId} start={it.duration > 60 ? 30 : 0} />
              <p className="text-xs text-gray-500 mt-1 select-text">
                <b className="text-gray-800">{it.videoTitle || it.title}</b>
                {" · "}{[it.channel, formatDuration(it.duration), it.sessionName && `soirée « ${it.sessionName} »`, new Date(it.at).toLocaleDateString("fr-FR"), it.times > 1 && `ajoutée ${it.times} fois`].filter(Boolean).join(" · ")}
              </p>
              {it.reports.map((r, k) => (
                <p key={k} className="text-xs text-red-700 mt-0.5">🚩 {r.reasons.map((x) => REASON_LABEL[x] || x).join(" · ")}{r.comment && <i> — « {r.comment} »</i>}</p>
              ))}
            </div>
            <div className="space-y-3 min-w-0">
              <LinkAddPanel key={it.videoId} item={it} call={call} onDone={() => { onDone(it); next(); }} />
              <div className="flex gap-2">
                <button onClick={() => setI((x) => Math.max(0, x - 1))} disabled={i === 0} className="text-sm font-bold bg-gray-100 px-3 py-2 rounded-2xl disabled:opacity-40">←</button>
                <button onClick={next} className="flex-1 text-sm font-bold bg-gray-100 px-3 py-2 rounded-2xl">Plus tard →</button>
                <button onClick={() => { onIgnore(it); next(); }} title="Pas une chanson, ou sans intérêt : ne revient plus" className="flex-1 text-sm font-bold text-gray-700 bg-white border border-gray-200 px-3 py-2 rounded-2xl">✕ Ignorer</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
