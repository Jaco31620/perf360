"use client";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { getSuperToken } from "../storage";
import { VideoPreview, PreviewThumb } from "../Controls";
import { SEARCH_MODES, formatDuration } from "@/lib/jukebox";
import { DECADES, decadeLabel } from "@/lib/jukeboxBlind";
import { FR_NEXT, MODE_TAG, modeLabel, SearchInput } from "./shared";
import { VideoTitle, SongName, SongTextForm } from "./SongParts";
import { Backup } from "./Backup";
import { SongVideoChooser, SongReview, ChangeInfo, SongTitleChooser } from "./SongReview";

/* Mémoire des titres : effet immédiat d'une action sur la liste affichée.
 * Année et langue valent pour toutes les versions (modes) du titre. */
function applySong(list, body) {
  if (!list) return list;
  const id = String(body.key || "").split(":")[1];
  switch (body.action) {
    case "forgetSong": return list.filter((s) => s.key !== body.key);
    case "mergeSongs": return list.filter((s) => !body.keys.includes(s.key)).map((s) => (s.key === body.keep ? { ...s, group: undefined } : s));
    case "ignoreDup": return list.filter((s) => s.group !== body.group);
    case "songText": return list.map((s) => (s.key.split(":")[1] !== id ? s : {
      ...s, fixed: true, ...(body.artist.trim() ? { artist: body.artist.trim() } : {}), ...(body.title.trim() ? { title: body.title.trim() } : {}),
    }));
    case "validateSong": return list.map((s) => (s.key === body.key ? { ...s, validated: !!body.validated } : s));
    case "blindSong": return list.map((s) => (s.key === body.key ? { ...s, blind: !!body.blind } : s));
    case "lyricsSong": return list.map((s) => (s.key === body.key ? { ...s, lyrics: !!body.lyrics } : s));
    case "trimVideo": return list.map((s) => (s.videoId === body.videoId ? { ...s, start: body.start || 0, end: body.end ?? null } : s));
    case "songMeta": return list.map((s) => (s.key.split(":")[1] !== id ? s : {
      ...s, enriched: true,
      ...("year" in body ? { year: parseInt(body.year, 10) || null } : {}),
      ...("fr" in body ? { fr: body.fr } : {}),
    }));
    default: return list;
  }
}

/* Mémoire « titre Deezer → vidéo YouTube », à passer en revue : filtres
 * (à vérifier / validés, mode), aperçu de la vidéo retenue, validation,
 * changement de vidéo (repasse « à vérifier »), oubli (le titre sera recherché à
 * nouveau au prochain ajout). */
const STATUS_FILTERS = [["all", "Tous"], ["changes", "🔄 Proposés"], ["todo", "À vérifier"], ["suspect", "🧐 Suspects"], ["dups", "👯 Doublons"], ["missing", "⚠️ À remplacer"], ["ok", "Validés"], ["blind", "🕵️ Blind test"], ["lyrics", "📝 Avec paroles"]];
const SORTS = [["added", "Derniers ajoutés"], ["plays", "Plus joués"], ["rank", "Plus connus"], ["year", "Année"], ["alpha", "A → Z"]];
const LANG_FILTERS = [["", "Toutes langues"], ["fr", "🇫🇷 Français"], ["intl", "🌍 International"], ["unknown", "❓ Langue inconnue"]];
export function SongMemory({ call, total, proposals = 0, focus, enrich, onChanged }) {
  const [open, setOpen] = useState(true);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [sort, setSort] = useState("added");
  const [editing, setEditing] = useState(null); // clé du titre dont on corrige le texte
  // tuile « Titres en mémoire » : liste complète, sans filtre
  useEffect(() => {
    if (!focus) return;
    setOpen(true);
    setStatus("all");
    setQ("");
    setLang("");
    setDecade("");
  }, [focus]);
  const [mode, setMode] = useState("");
  const [lang, setLang] = useState("");
  const [decade, setDecade] = useState("");
  const [enriching, setEnriching] = useState(false);
  const [songs, setSongs] = useState(null);
  const [err, setErr] = useState("");
  const [fixing, setFixing] = useState(null); // titre dont on change la vidéo
  const [retitling, setRetitling] = useState(null); // titre rattaché à un autre titre Deezer
  const [preview, setPreview] = useState(null); // clé du titre en aperçu
  const [review, setReview] = useState(null); // revue : clés des titres à passer, position

  const lastAct = useRef(0); // liste relue avant la dernière action : périmée
  const queue = useRef(Promise.resolve());
  const load = useCallback(async () => {
    const started = Date.now();
    try {
      const qs = new URLSearchParams({ songs: "1", q, status, mode, lang, decade, sort });
      const res = await fetch(`/api/jukebox/super?${qs}`, {
        cache: "no-store", headers: { "x-jukebox-super": getSuperToken() || "" },
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Chargement impossible.");
      if (started < lastAct.current) return;
      setSongs(d.songs);
      setErr("");
    } catch (e) {
      setErr(e.message);
    }
  }, [q, status, mode, lang, decade, sort]);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [open, load]);

  // Effet affiché dès le clic, actions envoyées dans l'ordre ; la liste n'est
  // pas relue après chaque action (un titre validé reste visible jusqu'au
  // prochain changement de filtre, sans décaler les lignes sous la souris).
  const run = async (body, confirmText) => {
    if (confirmText && !confirm(confirmText)) return;
    lastAct.current = Date.now();
    setSongs((list) => applySong(list, body));
    const p = queue.current.then(() => call("POST", body));
    queue.current = p.catch(() => {});
    try {
      await p;
      if (["forgetSong", "mergeSongs"].includes(body.action)) onChanged?.(); // nombre de titres en mémoire
    } catch (e) { alert(e.message); lastAct.current = Date.now(); load(); }
  };
  // changements de vidéo (adopter, refuser, revenir) : liste et compteur relus
  const changeRun = async (body, confirmText) => {
    if (confirmText && !confirm(confirmText)) return;
    await run(body);
    await load();
    onChanged?.();
  };
  // appels successifs (~45 s chacun, MusicBrainz : 1 requête / s) jusqu'au bout
  const stopEnrich = useRef(false);
  const enrichNow = async () => {
    stopEnrich.current = false;
    setEnriching({ done: 0 });
    try {
      for (let total = 0; !stopEnrich.current;) {
        const d = await call("POST", { action: "enrich" });
        total += d.done;
        setEnriching({ done: total, pending: d.pending });
        load();
        if (!d.pending || !d.done) break;
      }
      onChanged?.();
    } catch (e) { alert(e.message); } finally { setEnriching(false); }
  };
  const editYear = (s) => {
    const v = prompt(`Année de sortie de « ${s.label} » (vide : inconnue)`, s.year || "");
    if (v !== null) run({ action: "songMeta", key: s.key, year: v.trim() });
  };

  return (
    <div className="bg-white rounded-2xl border border-purple-100">
      <button onClick={() => setOpen((v) => !v)} className="w-full flex justify-between items-center px-5 py-4 font-bold text-gray-900">
        <span>🧠 Mémoire des titres {typeof total === "number" && <span className="text-gray-400 font-normal">({total})</span>}</span>
        <span className="text-gray-400">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="px-5 pb-5 space-y-3">
          <p className="text-xs text-gray-500">
            Vidéo YouTube retenue pour chaque titre et chaque mode (cliquez la miniature pour l'écouter ici). <b>Valider</b> confirme
            qu'elle est bonne ; <b>Changer la vidéo</b> en choisit une autre, qui repasse « À vérifier » : testez-la (aperçu ouvert d'office) puis validez-la. Les corrections « Mauvaise vidéo ? » faites en régie arrivent aussi ici à vérifier ;
            <b> Oublier</b> la fera rechercher à nouveau au prochain ajout. L'<b>année</b> et la <b>langue</b> (filtres du blind test)
            sont trouvées automatiquement ; cliquez-les pour les corriger, comme le <b>titre</b> lui-même s'il désigne une reprise ou une compilation. <b>📝 Paroles</b> indique que la vidéo affiche les paroles
            (deviné d'après son titre YouTube : vérifiez-le en validant).
          </p>
          {(enrich > 0 || enriching) && (
            <div className="flex flex-wrap items-center gap-3 text-xs bg-sky-50 text-sky-800 rounded-xl px-3 py-2">
              <span>🔎 {enrich} ligne{enrich > 1 ? "s" : ""} sans année ni langue : complétées chaque nuit (Deezer + MusicBrainz, sans quota YouTube, environ 4 s par titre).</span>
              {enriching ? (
                <span className="flex items-center gap-2 font-bold">
                  ⏳ {enriching.done} titre{enriching.done > 1 ? "s" : ""} enrichi{enriching.done > 1 ? "s" : ""}{enriching.pending != null ? `, ${enriching.pending} ligne${enriching.pending > 1 ? "s" : ""} restante${enriching.pending > 1 ? "s" : ""}` : ""}…
                  <button onClick={() => { stopEnrich.current = true; }} className="underline font-normal">arrêter</button>
                </span>
              ) : (
                <button onClick={enrichNow} className="font-bold bg-sky-600 text-white px-3 py-1 rounded-full">Tout enrichir maintenant</button>
              )}
            </div>
          )}
          {proposals > 0 && status !== "changes" && (
            <div className="flex flex-wrap items-center gap-3 bg-orange-50 border border-orange-200 rounded-xl px-3 py-2 text-sm">
              <span className="flex-1 min-w-[200px] text-orange-900">
                🔄 <b>{proposals}</b> titre{proposals > 1 ? "s" : ""} vérifié{proposals > 1 ? "s" : ""} avec une autre vidéo proposée en soirée.
              </span>
              <button onClick={() => setStatus("changes")} className="font-bold bg-orange-500 text-white px-3 py-1 rounded-full">Voir</button>
            </div>
          )}
          {status === "changes" && <p className="text-xs text-gray-500">« Mauvaise vidéo ? » utilisé en soirée sur des titres déjà vérifiés : la soirée a changé de vidéo, la mémoire non. Comparez puis <b>adoptez</b> (la vidéo proposée devient celle de toutes les soirées, validée) ou <b>gardez l'actuelle</b>.</p>}
          {(() => {
            const todo = (songs || []).filter((s) => !s.validated && !s.missing);
            const shown = (songs || []).filter((s) => !s.missing);
            if (!todo.length) return shown.length > 0 && (
              <div className="flex flex-wrap items-center gap-3 bg-gray-50 rounded-xl px-3 py-2">
                <button onClick={() => { setPreview(null); setReview({ keys: shown.map((s) => s.key), i: 0 }); }}
                  className="text-sm font-bold text-white bg-gray-800 hover:bg-gray-900 px-4 py-1.5 rounded-full">
                  ▶ Revue de la liste affichée ({shown.length})
                </button>
                <span className="text-xs text-gray-500">Rien à vérifier ici : la revue repasse les titres affichés (validés compris), pour rogner une vidéo par exemple.</span>
              </div>
            );
            return (
              <div className="flex flex-wrap items-center gap-3 bg-fuchsia-50 rounded-xl px-3 py-2">
                <button onClick={() => { setPreview(null); setReview({ keys: todo.map((s) => s.key), i: 0 }); }}
                  className="text-sm font-bold text-white bg-fuchsia-600 hover:bg-fuchsia-700 px-4 py-1.5 rounded-full">
                  ▶ Revue des titres à vérifier ({todo.length})
                </button>
                <span className="text-xs text-fuchsia-900/70">
                  Un titre à la fois, vidéo lancée à 40 s, raccourcis clavier. Titres non validés de la liste affichée, dans son ordre (tri « Plus joués » : les plus utiles d'abord).
                </span>
              </div>
            );
          })()}
          <div className="flex flex-wrap gap-2 items-center">
            <div className="flex flex-wrap bg-gray-100 rounded-2xl p-0.5 text-sm">
              {STATUS_FILTERS.map(([id, label]) => (
                <button key={id} onClick={() => setStatus(id)}
                  className={`px-3 py-1 rounded-full font-bold ${status === id ? "bg-fuchsia-600 text-white" : "text-gray-500 hover:text-gray-900"}`}>
                  {label}
                </button>
              ))}
            </div>
            <select value={mode} onChange={(e) => setMode(e.target.value)} className="border-2 border-gray-200 rounded-full px-3 py-1 text-sm font-semibold">
              <option value="">Tous les modes</option>
              {SEARCH_MODES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
            <select value={lang} onChange={(e) => setLang(e.target.value)} className="border-2 border-gray-200 rounded-full px-3 py-1 text-sm font-semibold">
              {LANG_FILTERS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
            <select value={decade} onChange={(e) => setDecade(e.target.value)} className="border-2 border-gray-200 rounded-full px-3 py-1 text-sm font-semibold">
              <option value="">Toutes décennies</option>
              {DECADES.map((d) => <option key={d} value={d}>{decadeLabel(d)}</option>)}
              <option value="unknown">❓ Année inconnue</option>
            </select>
            {status !== "dups" && (
              <select value={sort} onChange={(e) => setSort(e.target.value)} className="border-2 border-gray-200 rounded-full px-3 py-1 text-sm font-semibold">
                {SORTS.map(([id, label]) => <option key={id} value={id}>↕ {label}</option>)}
              </select>
            )}
            <SearchInput value={q} onChange={setQ} placeholder="Rechercher un artiste, un titre…" className="flex-1 min-w-[180px]" />
          </div>
          {status === "suspect" && <p className="text-xs text-gray-500">Titres non validés dont la vidéo semble ne pas correspondre : durée très différente du titre, titre absent de la vidéo, version live, reprise… Vérifiez-les puis validez ou changez la vidéo.</p>}
          {status === "dups" && <p className="text-xs text-gray-500">Titres qui se ressemblent dans le même mode (même vidéo, ou interprète et titre proches). <b>Garder celui-ci</b> fusionne le groupe : écoutes, étiquettes, année et langue sont regroupées sur la ligne gardée, et les autres titres Deezer joueront sa vidéo (sans nouvelle recherche YouTube).</p>}
          {err && <p className="text-sm text-red-600">{err}</p>}
          {review && (
            <SongReview review={review} setReview={setReview} songs={songs} run={run} changeRun={changeRun} call={call} editYear={editYear}
              busy={!!(fixing || retitling)} onFix={setFixing} onRetitle={setRetitling} onClose={() => { setReview(null); load(); }} />
          )}
          {retitling && <SongTitleChooser song={retitling} call={call} onClose={() => setRetitling(null)}
            onDone={(key) => {
              // revue en cours : la ligne change de clé (autre titre Deezer)
              if (key && key !== retitling.key) setReview((r) => r && { ...r, keys: r.keys.map((k) => (k === retitling.key ? key : k)) });
              load();
            }} />}
          {fixing && <SongVideoChooser song={fixing} call={call} onClose={() => setFixing(null)}
            onDone={() => { setStatus((st) => (st === "ok" ? "all" : st)); if (!review) setPreview(fixing.key); load(); }} />}
          {songs === null ? <p className="text-sm text-gray-400">Chargement…</p> : songs.length === 0 ? (
            <p className="text-sm text-gray-400">{status === "todo" ? "Rien à vérifier 🎉" : status === "missing" ? "Aucune vidéo disparue 👍" : status === "blind" ? "Aucun titre marqué « Blind test » : utilisez l'étiquette 🕵️ sur les titres (filtre Tous)." : status === "lyrics" ? "Aucun titre marqué « Avec paroles » : utilisez l'étiquette 📝 sur les titres (filtre Tous)." : status === "changes" ? "Aucun changement de vidéo proposé 👍" : "Aucun titre."}</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {songs.map((s, i) => (<Fragment key={s.key}>
                {s.group != null && s.group !== songs[i - 1]?.group && (
                  <li className="flex flex-wrap items-center justify-between gap-2 pt-4 pb-1">
                    <span className="text-xs font-bold text-gray-500 uppercase tracking-wide">👯 Doublons possibles · {s.dupWhy}</span>
                    <button onClick={() => run({ action: "ignoreDup", group: s.group, keys: songs.filter((x) => x.group === s.group).map((x) => x.key) })}
                      className="text-xs font-bold text-gray-500 bg-gray-100 px-3 py-1 rounded-full">Ce ne sont pas des doublons</button>
                  </li>
                )}
                <li className="flex flex-wrap items-center gap-3 py-2.5">
                  <PreviewThumb videoId={s.videoId} active={preview === s.key} onClick={() => setPreview(preview === s.key ? null : s.key)} />
                  <div className="flex-1 min-w-[160px]">
                    {editing === s.key ? (
                      <SongTextForm song={s} onCancel={() => setEditing(null)}
                        onSave={(artist, title) => { setEditing(null); run({ action: "songText", key: s.key, artist, title }); }} />
                    ) : (
                      <SongName song={s} onArtist={(a) => { setQ(a); setStatus("all"); }} onTitle={() => setRetitling(s)} onEdit={() => setEditing(s.key)} />
                    )}
                    <VideoTitle song={s} className="truncate" />
                    <div className="flex flex-wrap items-center gap-1.5 mt-1">
                      <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${MODE_TAG[s.mode] || "bg-gray-100 text-gray-600"}`}>{modeLabel(s.mode)}</span>
                      {s.missing
                        ? <span className="text-[11px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap bg-red-100 text-red-700" title="La vidéo n'existe plus ou n'est plus lisible : choisissez-en une autre">⚠️ Vidéo disparue · à remplacer</span>
                        : s.validated
                        ? <span className="text-[11px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap bg-green-100 text-green-700">✓ Validé</span>
                        : <span className="text-[11px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap bg-gray-100 text-gray-500">À vérifier</span>}
                      <button onClick={() => editYear(s)} title="Année de sortie (cliquer pour corriger)"
                        className={`text-[11px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${s.year ? "bg-indigo-100 text-indigo-700" : "bg-gray-100 text-gray-400"}`}>
                        {s.year || (s.enriched ? "année ?" : "…")}
                      </button>
                      <button onClick={() => run({ action: "songMeta", key: s.key, fr: FR_NEXT[String(s.fr)] })}
                        title="Langue (cliquer : français → international → inconnue)"
                        className={`text-[11px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${s.fr === null ? "bg-gray-100 text-gray-400" : "bg-indigo-100 text-indigo-700"}`}>
                        {s.fr === true ? "🇫🇷 Français" : s.fr === false ? "🌍 International" : s.enriched ? "❓ langue" : "…"}
                      </button>
                      <button onClick={() => run({ action: "blindSong", key: s.key, blind: !s.blind })}
                        title={s.blind ? "Retirer du blind test" : "Utiliser dans le blind test"}
                        className={`text-[11px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${s.blind ? "bg-violet-600 text-white" : "bg-gray-100 text-gray-400 hover:text-gray-700"}`}>
                        🕵️ Blind test{s.blind ? "" : " ?"}
                      </button>
                      <button onClick={() => run({ action: "lyricsSong", key: s.key, lyrics: !s.lyrics })}
                        title={s.lyrics ? "La vidéo n'affiche pas les paroles" : "La vidéo affiche les paroles"}
                        className={`text-[11px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${s.lyrics ? "bg-amber-500 text-white" : "bg-gray-100 text-gray-400 hover:text-gray-700"}`}>
                        📝 Paroles{s.lyrics ? "" : " ?"}
                      </button>
                      {(s.start > 0 || s.end != null) && (
                        <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-fuchsia-100 text-fuchsia-700" title="Vidéo rognée : partie jouée en soirée">
                          ✂️ {formatDuration(Math.floor(s.start || 0))} → {s.end != null ? formatDuration(Math.round(s.end)) : "fin"}
                        </span>
                      )}
                      {s.suspect?.length > 0 && (
                        <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-orange-100 text-orange-700" title="Vidéo à vérifier en priorité">🧐 {s.suspect.join(" · ")}</span>
                      )}
                    </div>
                    <p className="text-xs text-gray-400 mt-1">{s.plays > 0 && <span className="font-bold text-gray-500" title="Joué jusqu'au bout en soirée">▶ joué {s.plays}× · </span>}{formatDuration(s.duration)} · vérifié le {new Date(s.checkedAt).toLocaleDateString("fr-FR")}</p>
                    <ChangeInfo song={s} run={changeRun} onCompare={() => {
                      const keys = songs.filter((x) => !x.missing).map((x) => x.key);
                      setPreview(null);
                      setReview({ keys, i: Math.max(0, keys.indexOf(s.key)) });
                    }} />
                  </div>
                  <div className="flex flex-wrap gap-1.5 shrink-0">
                    {s.group != null && (
                      <button onClick={() => {
                        const others = songs.filter((x) => x.group === s.group && x.key !== s.key);
                        run({ action: "mergeSongs", keep: s.key, keys: others.map((x) => x.key) },
                          `Garder « ${s.artist} – ${s.title} » et y fusionner :\n${others.map((x) => `• ${x.artist} – ${x.title}`).join("\n")}\n\nLes autres titres joueront cette vidéo.`);
                      }} className="text-xs font-bold text-white bg-fuchsia-600 px-3 py-1.5 rounded-full">⭐ Garder celui-ci</button>
                    )}
                    {!s.missing && (
                      <button onClick={() => {
                        const keys = songs.filter((x) => !x.missing).map((x) => x.key);
                        setPreview(null);
                        setReview({ keys, i: Math.max(0, keys.indexOf(s.key)) });
                      }} title="Ouvrir ce titre dans la revue (vérifier, rogner la vidéo…), puis continuer avec les suivants de la liste"
                        className="text-xs font-bold bg-fuchsia-50 text-fuchsia-700 px-3 py-1.5 rounded-full">🔎 Revue</button>
                    )}
                    {s.missing ? null : s.validated ? (
                      <button onClick={() => run({ action: "validateSong", key: s.key, validated: false })}
                        className="text-xs font-bold text-gray-500 bg-gray-100 px-3 py-1.5 rounded-full">Retirer la validation</button>
                    ) : (
                      <button onClick={() => run({ action: "validateSong", key: s.key, validated: true })}
                        className="text-xs font-bold text-green-700 bg-green-100 px-3 py-1.5 rounded-full">✓ Valider</button>
                    )}
                    <button onClick={() => setFixing(s)} className={`text-xs font-bold px-3 py-1.5 rounded-full ${s.missing ? "bg-red-600 text-white" : "bg-gray-100"}`}>
                      {s.missing ? "Remplacer la vidéo" : "Changer la vidéo"}
                    </button>
                    <button onClick={() => run({ action: "forgetSong", key: s.key }, `Oublier « ${s.label || s.key} » (${modeLabel(s.mode)}) ?\nLe titre sera recherché à nouveau au prochain ajout.`)}
                      className="text-xs font-bold text-red-600 bg-red-50 px-3 py-1.5 rounded-full">Oublier</button>
                  </div>
                  {preview === s.key && (
                    <div className="w-full max-w-xl"><VideoPreview videoId={s.videoId} onClose={() => setPreview(null)} /></div>
                  )}
                </li>
              </Fragment>))}
            </ul>
          )}
          {songs?.length === 200 && <p className="text-xs text-gray-400 text-center">200 premiers titres affichés : affinez avec les filtres ou la recherche.</p>}
          <Backup call={call} onImported={() => { load(); onChanged?.(); }} />
        </div>
      )}
    </div>
  );
}
