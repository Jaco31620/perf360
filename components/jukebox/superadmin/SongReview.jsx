"use client";
import { useEffect, useRef, useState } from "react";
import { getSuperToken } from "../storage";
import { VideoChooser, VideoPreview, PreviewThumb } from "../Controls";
import TrimPlayer from "../TrimPlayer";
import { formatDuration } from "@/lib/jukebox";
import { fmtDate, FR_NEXT, MODE_TAG, modeLabel } from "./shared";
import { VideoTitle, SongName, SongTextForm } from "./SongParts";

export function SongVideoChooser({ song, call, onClose, onDone }) {
  return (
    <VideoChooser title={song.label || song.key} subtitle={`Mode ${modeLabel(song.mode)}`} initial={song.videoId}
      heading="Changer la vidéo" help="La vidéo choisie remplace celle de ce titre pour toutes les soirées. Cliquez une miniature pour l'écouter."
      onClose={onClose} onDone={onDone}
      load={() => call("POST", { action: "songVideos", key: song.key })}
      choose={(videoId) => call("POST", { action: "replaceSong", key: song.key, videoId })} />
  );
}

/* Revue des titres à vérifier, un par un : vidéo lancée à 40 s (là où les
 * paroles s'affichent), étiquettes en grand, raccourcis clavier. Les actions
 * passent par run() (effet immédiat sur la liste de la mémoire). */
const REVIEW_START = 40;
const Key = ({ k }) => <kbd className="ml-1.5 text-[10px] font-mono bg-black/10 rounded px-1 py-0.5">{k}</kbd>;

export function SongReview({ review, setReview, songs, run, changeRun, call, editYear, busy, onFix, onRetitle, onClose }) {
  const [compare, setCompare] = useState(null); // vidéo proposée en aperçu (à la place de l'actuelle)
  const { keys, i } = review;
  const [editing, setEditing] = useState(null); // correction du texte : champ à éditer (artist | title)
  const [artistOpen, setArtistOpen] = useState(false); // autres titres de l'interprète, sans quitter la revue
  useEffect(() => { setEditing(null); setCompare(null); }, [i]);
  const song = i < keys.length ? (songs || []).find((s) => s.key === keys[i]) : null;
  // proposition adoptée ou refusée : l'aperçu se referme
  useEffect(() => {
    if (compare && !(song?.proposals || []).some((c) => c.newVideo === compare)) setCompare(null);
  }, [song?.proposals, compare]);
  const go = (d) => setReview((r) => ({ ...r, i: Math.max(0, Math.min(r.keys.length, r.i + d)) }));
  const act = {
    validate: () => { if (song && !song.missing) run({ action: "validateSong", key: song.key, validated: true }); go(1); },
    lyrics: () => song && run({ action: "lyricsSong", key: song.key, lyrics: !song.lyrics }),
    blind: () => song && run({ action: "blindSong", key: song.key, blind: !song.blind }),
    fix: () => song && onFix(song),
    text: () => song && setEditing("title"),
    artist: () => setArtistOpen((v) => !v),
    retitle: () => song && onRetitle(song),
    forget: () => {
      if (!song || !confirm(`Oublier « ${song.label || song.key} » (${modeLabel(song.mode)}) ?\nLe titre sera recherché à nouveau au prochain ajout.`)) return;
      run({ action: "forgetSong", key: song.key });
      go(1);
    },
    next: () => go(1),
    prev: () => go(-1),
  };
  const actRef = useRef(act);
  actRef.current = act;
  useEffect(() => {
    const onKey = (e) => {
      if (busy || e.ctrlKey || e.metaKey || e.altKey || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
      const a = actRef.current;
      const k = e.key.toLowerCase();
      const fn = { v: a.validate, p: a.lyrics, b: a.blind, c: a.fix, o: a.forget, t: a.text, r: a.retitle, a: a.artist, arrowright: a.next, n: a.next, arrowleft: a.prev, escape: onClose }[k];
      if (fn) { e.preventDefault(); fn(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const tool = "text-sm font-bold bg-gray-100 hover:bg-gray-200 px-3 py-2 rounded-xl text-left whitespace-nowrap";
  const tag = "text-[11px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap";
  return (
    <div className="fixed inset-0 z-40 bg-black/70 flex items-center justify-center p-2 sm:p-3" onClick={onClose}>
      {/* Écran de portable : vidéo à gauche (taille réglée sur la hauteur de l'écran), infos et boutons à droite. */}
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-6xl max-h-[97vh] flex flex-col bg-white rounded-3xl p-4 gap-3 shadow-2xl">
        <div className="flex items-center gap-3 shrink-0">
          <p className="text-xs font-bold uppercase tracking-wider text-fuchsia-600 whitespace-nowrap">
            Revue · {Math.min(i + 1, keys.length)} / {keys.length}
          </p>
          <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full bg-fuchsia-500 transition-all" style={{ width: `${(Math.min(i, keys.length) / keys.length) * 100}%` }} />
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-2xl leading-none" aria-label="Fermer (Échap)" title="Fermer (Échap)">×</button>
        </div>
        {i >= keys.length ? (
          <div className="text-center py-10 space-y-3">
            <p className="text-3xl">🎉</p>
            <p className="font-bold">Revue terminée</p>
            <div className="flex justify-center gap-2">
              <button onClick={() => go(-1)} className="text-sm font-bold bg-gray-100 px-4 py-2 rounded-full">← Revenir au dernier</button>
              <button onClick={onClose} className="text-sm font-bold text-white bg-fuchsia-600 px-4 py-2 rounded-full">Fermer</button>
            </div>
          </div>
        ) : !song ? (
          <div className="text-center py-10 space-y-3">
            <p className="text-sm text-gray-500">Ce titre n'est plus dans la liste (oublié, ou filtre changé).</p>
            <button onClick={() => go(1)} className="text-sm font-bold bg-gray-100 px-4 py-2 rounded-full">Suivant →</button>
          </div>
        ) : (
          <div className="flex-1 min-h-0 overflow-y-auto grid gap-4 lg:grid-cols-[minmax(0,1.45fr)_minmax(300px,1fr)] items-start">
            <div className="mx-auto w-full" style={{ maxWidth: "calc((97vh - 250px) * 16 / 9)" }}>
              {compare ? (
                <div className="space-y-1">
                  <p className="text-xs font-bold text-orange-700">🔄 Vidéo proposée — <button onClick={() => setCompare(null)} className="underline">revenir à l'actuelle</button></p>
                  <VideoPreview videoId={compare} start={song.duration > REVIEW_START + 20 ? REVIEW_START : 0} />
                </div>
              ) : <TrimPlayer key={song.videoId} song={song} busy={busy} previewStart={song.duration > REVIEW_START + 20 ? REVIEW_START : 0}
                onSave={(t) => run({ action: "trimVideo", ...t })}
                suggest={async (videoId, duration) => (await call("POST", { action: "trimSuggest", videoId, duration })).hint} />}
              <div className="flex items-center gap-2 mt-1 text-xs text-gray-400">
                <div className="flex-1 min-w-0"><VideoTitle song={song} className="truncate" /></div>
                <a href={`https://www.youtube.com/watch?v=${song.videoId}`} target="_blank" rel="noreferrer" className="shrink-0 hover:text-gray-700 underline">YouTube ↗</a>
              </div>
            </div>

            <div className="space-y-3 min-w-0">
              <div>
                {editing ? (
                  <SongTextForm song={song} focus={editing} onCancel={() => setEditing(null)}
                    onSave={(artist, title) => { setEditing(null); run({ action: "songText", key: song.key, artist, title }); }} />
                ) : (
                  <SongName song={song} wrap className="text-lg font-bold leading-snug" artistActive={artistOpen}
                    artistHint="Autres titres de cet interprète (A)" titleHint="Corriger le texte (T)"
                    onArtist={() => setArtistOpen((v) => !v)} onTitle={() => setEditing("title")} onEdit={() => setEditing("artist")} />
                )}
                {song.suspect?.length > 0 && (
                  <p className="mt-1.5 text-xs font-bold text-orange-700 bg-orange-50 rounded-lg px-2 py-1">🧐 À vérifier de près : {song.suspect.join(" · ")}</p>
                )}
                <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                  <span className={`${tag} ${MODE_TAG[song.mode] || "bg-gray-100 text-gray-600"}`}>{modeLabel(song.mode)}</span>
                  {song.missing
                    ? <span className={`${tag} bg-red-100 text-red-700`}>⚠️ Vidéo disparue · à remplacer</span>
                    : song.validated
                    ? <span className={`${tag} bg-green-100 text-green-700`}>✓ Validé</span>
                    : <span className={`${tag} bg-gray-100 text-gray-500`}>À vérifier</span>}
                  <button onClick={() => editYear(song)} title="Année de sortie (cliquer pour corriger)"
                    className={`${tag} ${song.year ? "bg-indigo-100 text-indigo-700" : "bg-gray-100 text-gray-400"}`}>
                    {song.year || (song.enriched ? "année ?" : "…")}
                  </button>
                  <button onClick={() => run({ action: "songMeta", key: song.key, fr: FR_NEXT[String(song.fr)] })} title="Langue (cliquer : français → international → inconnue)"
                    className={`${tag} ${song.fr === null ? "bg-gray-100 text-gray-400" : "bg-indigo-100 text-indigo-700"}`}>
                    {song.fr === true ? "🇫🇷 Français" : song.fr === false ? "🌍 International" : song.enriched ? "❓ langue" : "…"}
                  </button>
                  <span className="text-xs text-gray-400">
                    {song.plays > 0 && <b className="text-gray-500">▶ joué {song.plays}× · </b>}{formatDuration(song.duration)}
                  </span>
                </div>
                <ChangeInfo song={song} run={changeRun} compare={compare} onPreview={(v) => setCompare(compare === v ? null : v)} />
                {artistOpen && song.artist && <div className="max-h-48 overflow-y-auto mt-2"><ArtistSongs artist={song.artist} current={song.key} /></div>}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button onClick={act.lyrics} className={`text-sm font-bold px-3 py-2 rounded-xl text-left ${song.lyrics ? "bg-amber-500 text-white" : "bg-gray-100 text-gray-500 hover:text-gray-900"}`}>
                  📝 {song.lyrics ? "Avec paroles" : "Sans paroles"}<Key k="P" />
                </button>
                <button onClick={act.blind} className={`text-sm font-bold px-3 py-2 rounded-xl text-left ${song.blind ? "bg-violet-600 text-white" : "bg-gray-100 text-gray-500 hover:text-gray-900"}`}>
                  🕵️ {song.blind ? "Blind test" : "Pas au blind"}<Key k="B" />
                </button>
                <button onClick={act.fix} className={tool}>🎬 {song.missing ? "Remplacer vidéo" : "Changer vidéo"}<Key k="C" /></button>
                <button onClick={act.text} className={tool} title="Corriger l'interprète ou le titre affichés (faute, majuscules, mention en trop), sans changer de titre ni de vidéo">✎ Texte<Key k="T" /></button>
                <button onClick={act.artist} className={`${tool} ${artistOpen ? "!bg-fuchsia-100 text-fuchsia-800" : ""}`} title="Autres titres de cet interprète en mémoire, pour comparer (orthographe, doublons)">👤 Interprète<Key k="A" /></button>
                <button onClick={act.retitle} className={tool} title="Mauvais titre Deezer (reprise, compilation…) : rattacher au bon titre">🔁 Autre titre<Key k="R" /></button>
              </div>

              <div className="flex gap-2">
                <button onClick={act.prev} disabled={i === 0} title="Précédent (←)" className="text-sm font-bold bg-gray-100 px-3 py-3 rounded-2xl disabled:opacity-40">←</button>
                <button onClick={act.next} className="text-sm font-bold bg-gray-100 px-3 py-3 rounded-2xl whitespace-nowrap">Passer<Key k="→" /></button>
                <button onClick={act.validate} disabled={song.missing}
                  className="flex-1 text-sm font-bold text-white bg-green-600 hover:bg-green-700 px-3 py-3 rounded-2xl disabled:opacity-40 whitespace-nowrap">
                  ✓ Valider et suivant<Key k="V" />
                </button>
              </div>
              <div className="flex items-start gap-3">
                <details className="flex-1 text-xs text-gray-400">
                  <summary className="cursor-pointer hover:text-gray-600">Aide</summary>
                  <p className="mt-1">
                    Validé = la vidéo est le bon titre, dans la bonne version, et les étiquettes sont justes. <b>⏮ Début ici / Fin ici ⏭</b> (D / F) rognent l'habillage de la vidéo (intro, logo, scène parlée) : réglé pour cette vidéo dans toutes les soirées. <b>✎ Texte</b> corrige l'interprète
                    ou le titre affichés (faute, majuscules ; clic sur le titre aussi) ; <b>👤 Interprète</b> montre ses autres titres en mémoire (clic sur
                    son nom aussi) ; <b>🔁 Autre titre</b> rattache au bon titre Deezer (reprise, compilation). On reste dans la revue. Échap pour fermer.
                  </p>
                </details>
                <button onClick={act.forget} className="text-xs font-bold text-red-600 hover:bg-red-50 px-2 py-1 rounded-lg shrink-0">Oublier<Key k="O" /></button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* Changements de vidéo d'un titre (lib/jukeboxChanges.js) : propositions
 * faites en soirée (titre validé) à adopter / refuser, et dernier changement
 * appliqué (qui, quand) avec retour à la vidéo d'avant. */
const changeWho = (c) => (c.bySuper ? "super-admin" : [c.organizer && `👤 ${c.organizer}`, c.sessionName && `soirée « ${c.sessionName} »`].filter(Boolean).join(" · ") || "une soirée");
const changeWhen = (c) => fmtDate(c.at);
export function ChangeInfo({ song, run, onCompare, onPreview, compare }) {
  const props = song.proposals || [];
  const last = song.lastChange;
  if (!props.length && !last) return null;
  return (
    <div className="mt-1.5 space-y-1">
      {props.map((c) => (
        <div key={c.id} className="flex flex-wrap items-center gap-2 bg-orange-50 border border-orange-200 rounded-lg px-2 py-1.5 text-xs">
          <PreviewThumb videoId={c.newVideo} className="w-16" active={compare === c.newVideo} onClick={() => (onPreview ? onPreview(c.newVideo) : onCompare?.())} />
          <span className="flex-1 min-w-[160px]">
            🔄 <b>Autre vidéo proposée</b> par {changeWho(c)}, le {changeWhen(c)}
            {c.newTitle && <span className="block text-gray-500 truncate">▶ {c.newTitle}{c.newDuration ? ` · ${formatDuration(c.newDuration)}` : ""}</span>}
          </span>
          {onCompare && <button onClick={onCompare} className="font-bold text-orange-800 underline">comparer</button>}
          <button onClick={() => run({ action: "changeAccept", id: c.id }, "Adopter la vidéo proposée pour toutes les soirées ? (elle sera marquée validée)")}
            className="font-bold bg-green-600 text-white px-2.5 py-1 rounded-lg">✓ Adopter</button>
          <button onClick={() => run({ action: "changeReject", id: c.id })} className="font-bold bg-white border border-gray-200 px-2.5 py-1 rounded-lg">✕ Garder l'actuelle</button>
        </div>
      ))}
      {last && (
        <p className="text-[11px] text-gray-500">
          🔁 Vidéo changée le {changeWhen(last)} par {changeWho(last)}
          {last.oldVideo && (
            <button onClick={() => run({ action: "changeRevert", id: last.id }, "Revenir à la vidéo d'avant ce changement ? (elle repassera « à vérifier »)")}
              className="ml-2 font-bold text-fuchsia-600 underline">↩ revenir à l'ancienne</button>
          )}
        </p>
      )}
    </div>
  );
}

/* Mauvais titre Deezer (reprise, compilation…) : recherche dans Deezer et
 * rattachement de la ligne au bon titre (vidéo conservée). */
export function SongTitleChooser({ song, call, onClose, onDone }) {
  const [q, setQ] = useState((song.label || "").replace(" – ", " "));
  const [list, setList] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const search = async (e) => {
    e?.preventDefault();
    setError("");
    setList(null);
    try { setList((await call("POST", { action: "deezerSearch", q })).results || []); } catch (err) { setError(err.message); setList([]); }
  };
  useEffect(() => { search(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const choose = async (t) => {
    setBusy(true);
    setError("");
    try {
      const d = await call("POST", { action: "retargetSong", key: song.key, deezerId: t.deezerId });
      onDone(d.key);
      onClose();
    } catch (err) { setError(err.message); setBusy(false); }
  };
  const current = song.key.split(":")[1];
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-3" onClick={() => !busy && onClose()}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-lg max-h-[90vh] overflow-y-auto bg-white rounded-3xl p-5 space-y-3 shadow-2xl">
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold uppercase tracking-wider text-fuchsia-600">Corriger le titre</p>
            <p className="font-bold leading-snug">{song.label || song.key}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none" aria-label="Fermer">×</button>
        </div>
        <p className="text-xs text-gray-500">
          Choisissez la version originale : la ligne prend son artiste et son titre (réponses du blind test), la vidéo et les
          étiquettes sont conservées, l'année et la langue sont cherchées à nouveau.
        </p>
        <form onSubmit={search} className="flex gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Artiste et titre"
            className="flex-1 border-2 border-gray-200 rounded-full px-4 py-1.5 text-sm focus:border-fuchsia-500 outline-none" />
          <button className="text-sm font-bold text-white bg-fuchsia-600 px-4 py-1.5 rounded-full">Chercher</button>
        </form>
        {error && <p className="text-sm text-red-600">{error}</p>}
        {list === null ? <p className="text-sm text-gray-400">Recherche…</p> : list.length === 0 ? <p className="text-sm text-gray-400">Aucun résultat.</p> : (
          <ul className="divide-y divide-gray-100">
            {list.map((t) => {
              const same = String(t.deezerId) === current;
              return (
                <li key={t.id}>
                  <button disabled={busy || same} onClick={() => choose(t)}
                    className="w-full flex items-center gap-3 py-2 text-left hover:bg-fuchsia-50 rounded-xl px-1 disabled:opacity-60">
                    {t.thumb ? <img src={t.thumb} alt="" className="w-10 h-10 rounded-lg object-cover shrink-0" /> : <span className="w-10 h-10 rounded-lg bg-gray-100 shrink-0" />}
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-semibold truncate">{t.title}</span>
                      <span className="block text-xs text-gray-500 truncate">{t.channel} · {formatDuration(t.duration)}</span>
                    </span>
                    {same && <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 whitespace-nowrap">actuel</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

/* Revue : autres titres de l'interprète en mémoire (tous modes), pour
 * comparer l'orthographe, repérer un doublon ou une version différente. */
function ArtistSongs({ artist, current }) {
  const [list, setList] = useState(null);
  useEffect(() => {
    let off = false;
    setList(null);
    const qs = new URLSearchParams({ songs: "1", q: artist, status: "all", sort: "alpha" });
    fetch(`/api/jukebox/super?${qs}`, { cache: "no-store", headers: { "x-jukebox-super": getSuperToken() || "" } })
      .then((r) => r.json()).then((d) => !off && setList(d.songs || [])).catch(() => !off && setList([]));
    return () => { off = true; };
  }, [artist]);
  const others = (list || []).filter((s) => s.key !== current);
  const norm = (x) => String(x || "").toLowerCase();
  return (
    <div className="mt-2 rounded-xl bg-fuchsia-50/60 border border-fuchsia-100 px-3 py-2 text-xs">
      <p className="font-bold text-fuchsia-900 mb-1">👤 Autres titres de « {artist} » en mémoire {list && `(${others.length})`}</p>
      {!list ? <p className="text-gray-400">Chargement…</p> : others.length === 0 ? <p className="text-gray-500">Aucun autre titre.</p> : (
        <ul className="max-h-40 overflow-y-auto divide-y divide-fuchsia-100">
          {others.map((s) => (
            <li key={s.key} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 py-1">
              <span className={`font-semibold ${norm(s.artist) !== norm(artist) ? "text-orange-700" : "text-gray-800"}`}
                title={norm(s.artist) !== norm(artist) ? "Interprète écrit autrement" : undefined}>{s.artist}</span>
              <span className="text-gray-700">– {s.title}</span>
              <span className={`text-[10px] font-bold px-1.5 rounded-full ${MODE_TAG[s.mode] || "bg-gray-100 text-gray-600"}`}>{modeLabel(s.mode)}</span>
              {s.year && <span className="text-gray-400">{s.year}</span>}
              {s.missing ? <span className="text-red-600 font-bold">⚠️ à remplacer</span> : s.validated ? <span className="text-green-700 font-bold">✓</span> : <span className="text-gray-400">à vérifier</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
