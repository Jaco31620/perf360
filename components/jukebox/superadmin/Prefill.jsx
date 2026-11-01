"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { getSuperToken } from "../storage";
import { SEARCH_MODES } from "@/lib/jukebox";
import { fmtDate, MODE_TAG, modeLabel } from "./shared";

const STOP_TEXT = {
  quota: "quota épuisé, les titres restants seront cherchés demain",
  error: "YouTube indisponible, les titres restants seront cherchés demain",
  time: "temps écoulé", empty: "file terminée",
};

/* Pré-remplissage : titres mis en attente, cherchés chaque matin vers 6 h
 * avec le reste du quota YouTube de la veille. */
export function Prefill({ call, state, onChanged }) {
  const [open, setOpen] = useState(true);
  const [source, setSource] = useState("playlist"); // playlist | lines
  const [lines, setLines] = useState("");
  const [modes, setModes] = useState(["normal"]);
  const [blind, setBlind] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [plQuery, setPlQuery] = useState("");
  const [playlists, setPlaylists] = useState(null);
  const [showQueue, setShowQueue] = useState(true);
  const [queueVersion, setQueueVersion] = useState(0);

  const toggle = (id) => setModes((ms) => (ms.includes(id) ? ms.filter((m) => m !== id) : [...ms, id]));
  const send = async (body) => {
    setBusy(true);
    setMsg(null);
    try {
      const d = await call("POST", { action: "prefill", modes, blind, ...body });
      setMsg({ ok: true, text: `${d.added} ajouté${d.added > 1 ? "s" : ""} à la file${d.skipped ? `, ${d.skipped} déjà en mémoire ou en attente` : ""}.`, notFound: d.notFound });
      if (body.lines) setLines("");
      onChanged();
      setQueueVersion((v) => v + 1);
    } catch (e) {
      setMsg({ ok: false, text: e.message });
    } finally {
      setBusy(false);
    }
  };

  // Recherche de playlists Deezer, ou lien de playlist collé (ajout direct)
  const isLink = /deezer|^\d{3,15}$/i.test(plQuery.trim());
  const findPlaylists = async (e) => {
    e.preventDefault();
    const q = plQuery.trim();
    if (!q) return;
    if (isLink) return send({ playlist: q });
    try {
      const res = await fetch(`/api/jukebox/super?playlists=${encodeURIComponent(q)}`, {
        cache: "no-store", headers: { "x-jukebox-super": getSuperToken() || "" },
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Recherche impossible.");
      setPlaylists(d.playlists);
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    }
  };
  const last = state?.last;
  const cost = (n) => `${n} recherche${n > 1 ? "s" : ""} YouTube${modes.length > 1 ? ` × ${modes.length} modes` : ""}`;

  return (
    <div className="bg-white rounded-2xl border border-purple-100">
      <button onClick={() => setOpen((v) => !v)} className="w-full flex justify-between items-center px-5 py-4 font-bold text-gray-900">
        <span>🌅 Pré-remplir la mémoire {state && <span className="text-gray-400 font-normal">({state.pending} en attente)</span>}</span>
        <span className="text-gray-400">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="px-5 pb-5 space-y-3 text-sm">
          <p className="text-xs text-gray-500">
            Les titres en attente sont cherchés sur YouTube <b>chaque matin vers 6 h</b>, jusqu'à épuisement du quota (une centaine
            par jour au mieux). C'est le reste du quota de la veille : les soirées gardent un quota neuf. Chaque titre coûte une
            recherche par mode choisi ; les vidéos trouvées arrivent « À vérifier » dans la mémoire.
          </p>
          {last && (
            <p className="text-xs text-gray-600 bg-gray-50 rounded-xl px-3 py-2">
              Dernier passage le {fmtDate(Date.parse(last.at))} : {last.found} trouvé{last.found > 1 ? "s" : ""}
              {last.failed ? `, ${last.failed} sans résultat` : ""} ({STOP_TEXT[last.stop] || last.stop}).
              {last.error && <span className="block text-gray-400">{last.error}</span>}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-gray-600">Modes :</span>
            {SEARCH_MODES.map((m) => (
              <button key={m.id} onClick={() => toggle(m.id)}
                className={`px-3 py-1 rounded-full font-bold ${modes.includes(m.id) ? "bg-fuchsia-600 text-white" : "bg-gray-100 text-gray-500"}`}>
                {m.label}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={blind} onChange={(e) => setBlind(e.target.checked)} className="w-4 h-4 accent-violet-600" />
            <span>Marquer ces titres <b>🕵️ Blind test</b> (versions Normale : la vidéo est masquée)</span>
          </label>

          <div className="flex bg-gray-100 rounded-full p-0.5 w-fit">
            {[["playlist", "🎧 Playlist Deezer"], ["lines", "📝 Liste de titres"]].map(([id, label]) => (
              <button key={id} onClick={() => setSource(id)}
                className={`px-3 py-1 rounded-full font-bold ${source === id ? "bg-white shadow text-gray-900" : "text-gray-500"}`}>{label}</button>
            ))}
          </div>

          {source === "playlist" ? (
            <div className="space-y-2">
              <form onSubmit={findPlaylists} className="flex gap-2">
                <input value={plQuery} onChange={(e) => setPlQuery(e.target.value)}
                  placeholder="« blind test années 80 », « soirée »… ou lien de playlist Deezer"
                  className="flex-1 min-w-0 border-2 border-gray-200 rounded-full px-4 py-2 focus:border-fuchsia-500 outline-none" />
                <button disabled={busy || !plQuery.trim() || !modes.length} className="font-bold bg-fuchsia-600 disabled:opacity-40 text-white px-4 py-2 rounded-full">
                  {busy ? "…" : isLink ? "Ajouter" : "Chercher"}
                </button>
              </form>
              <p className="text-xs text-gray-400">
                Playlists publiques de Deezer : celles de Deezer, Filtr, Digster… ou n'importe quelle playlist partagée
                (Deezer → Partager → Copier le lien). 500 titres maximum par playlist.
              </p>
              {playlists && (playlists.length === 0 ? <p className="text-gray-400">Aucune playlist trouvée.</p> : (
                <ul className="divide-y divide-gray-100 max-h-80 overflow-y-auto">
                  {playlists.map((p) => (
                    <li key={p.id} className="flex items-center gap-3 py-2">
                      {p.cover && <img src={p.cover} alt="" className="w-12 h-12 rounded-lg object-cover shrink-0" />}
                      <div className="flex-1 min-w-0">
                        <a href={`https://www.deezer.com/playlist/${p.id}`} target="_blank" rel="noreferrer" className="font-semibold text-gray-900 hover:underline line-clamp-1">{p.title}</a>
                        <p className="text-xs text-gray-400">{p.tracks} titres · {p.by} · {cost(Math.min(p.tracks, 500))}</p>
                      </div>
                      <button disabled={busy || !modes.length} onClick={() => send({ playlist: String(p.id) })}
                        className="font-bold bg-gray-900 disabled:opacity-40 text-white text-xs px-3 py-1.5 rounded-full shrink-0">+ File</button>
                    </li>
                  ))}
                </ul>
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              <textarea value={lines} onChange={(e) => setLines(e.target.value)} rows={6}
                placeholder={"Un titre par ligne, par exemple :\nQueen - Bohemian Rhapsody\nAngèle - Balance ton quoi"}
                className="w-full border-2 border-gray-200 rounded-xl px-4 py-2.5 focus:border-fuchsia-500 outline-none" />
              <p className="text-xs text-gray-400">Pratique pour copier une liste trouvée sur un site (100 lignes max) : chaque ligne est cherchée sur Deezer.</p>
              <button disabled={busy || !lines.trim() || !modes.length} onClick={() => send({ lines })}
                className="font-bold bg-fuchsia-600 disabled:opacity-40 text-white px-4 py-2 rounded-full">
                {busy ? "…" : "Ajouter à la file"}
              </button>
            </div>
          )}

          <div className="flex flex-wrap gap-2 pt-1">
            <button onClick={() => setShowQueue((v) => !v)} className="font-bold bg-gray-100 px-4 py-2 rounded-full">
              {showQueue ? "Masquer la file" : `Voir la file (${state?.pending ?? 0})`}
            </button>
          </div>

          {msg && (
            <div className={msg.ok ? "text-green-700" : "text-red-600"}>
              <p>{msg.text}</p>
              {msg.notFound?.length > 0 && (
                <p className="text-xs text-gray-500 mt-1">Introuvables sur Deezer : {msg.notFound.join(" · ")}</p>
              )}
            </div>
          )}

          {showQueue && <PrefillQueue call={call} version={queueVersion} onChanged={onChanged} />}
        </div>
      )}
    </div>
  );
}

/* File du pré-remplissage : recherche, retrait, passage en tête, vidage. */
function PrefillQueue({ call, version, onChanged }) {
  const [items, setItems] = useState(null);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(new Set());

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/jukebox/super?prefill=1", { cache: "no-store", headers: { "x-jukebox-super": getSuperToken() || "" } });
      const d = await res.json();
      if (res.ok) setItems(d.items);
    } catch (e) { /* ignoré */ }
  }, []);
  useEffect(() => { load(); }, [load, version]);

  // effet affiché tout de suite, actions envoyées dans l'ordre
  const queue = useRef(Promise.resolve());
  const send = async (body, local) => {
    setItems(local);
    setSel(new Set());
    const p = queue.current.then(() => call("POST", body));
    queue.current = p.catch(() => {});
    try { await p; onChanged(); } catch (e) { alert(e.message); load(); }
  };
  const edit = (keys, op) => {
    const set = new Set(keys);
    const hit = items.filter((it) => set.has(it.key));
    const rest = items.filter((it) => !set.has(it.key));
    send({ action: "prefillEdit", keys, op }, op === "top" ? [...hit, ...rest] : rest);
  };
  const clear = () => {
    if (!confirm(`Vider la file (${items.length} titres en attente) ?`)) return;
    send({ action: "clearPrefill" }, []);
  };

  if (!items) return <p className="text-gray-400">Chargement…</p>;
  if (!items.length) return <p className="text-gray-400">La file est vide.</p>;
  const term = q.trim().toLowerCase();
  const shown = term ? items.filter((it) => `${it.artist} ${it.title}`.toLowerCase().includes(term)) : items;
  const toggleSel = (k) => setSel((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const allShown = shown.length > 0 && shown.every((it) => sel.has(it.key));

  return (
    <div className="border border-gray-200 rounded-2xl p-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filtrer la file…"
          className="flex-1 min-w-[160px] border-2 border-gray-200 rounded-full px-3 py-1 focus:border-fuchsia-500 outline-none" />
        <span className="text-xs text-gray-400">{shown.length} / {items.length} · traités dans l'ordre, du haut vers le bas</span>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input type="checkbox" checked={allShown} onChange={() => setSel(allShown ? new Set() : new Set(shown.map((it) => it.key)))} className="accent-fuchsia-600" />
          Tout sélectionner
        </label>
        {sel.size > 0 && (
          <>
            <button onClick={() => edit([...sel], "top")} className="font-bold bg-gray-100 px-2.5 py-1 rounded-full">⤒ En priorité ({sel.size})</button>
            <button onClick={() => edit([...sel], "remove")} className="font-bold text-red-600 bg-red-50 px-2.5 py-1 rounded-full">Retirer ({sel.size})</button>
          </>
        )}
        <button onClick={clear} className="font-bold text-red-600 ml-auto">Vider toute la file</button>
      </div>
      <ul className="divide-y divide-gray-100 max-h-96 overflow-y-auto">
        {shown.slice(0, 300).map((it) => (
          <li key={it.key} className="flex items-center gap-2 py-1.5">
            <input type="checkbox" checked={sel.has(it.key)} onChange={() => toggleSel(it.key)} className="accent-fuchsia-600 shrink-0" />
            <span className="flex-1 min-w-0 truncate"><b>{it.artist}</b> – {it.title}</span>
            <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap shrink-0 ${MODE_TAG[it.mode] || "bg-gray-100 text-gray-600"}`}>{modeLabel(it.mode)}</span>
            {it.blind && <span className="text-[11px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap bg-violet-600 text-white shrink-0">🕵️</span>}
            <button onClick={() => edit([it.key], "top")} title="Traiter en premier" className="text-gray-400 hover:text-gray-900 px-1 shrink-0">⤒</button>
            <button onClick={() => edit([it.key], "remove")} title="Retirer" className="text-gray-400 hover:text-red-600 px-1 shrink-0">✕</button>
          </li>
        ))}
        {shown.length > 300 && <li className="py-2 text-xs text-gray-400">… et {shown.length - 300} autres (filtrez pour les voir)</li>}
      </ul>
    </div>
  );
}
