"use client";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { getSuperToken } from "../storage";
import { VideoPreview, PreviewThumb } from "../Controls";
import { SEARCH_MODES, formatDuration } from "@/lib/jukebox";
import { DECADES, decadeLabel } from "@/lib/jukeboxBlind";
import { FR_NEXT, MODE_TAG, MODE_ICON, modeLabel, SearchInput, VersionLabel } from "./shared";
import { VideoTitle, SongName, SongTextForm } from "./SongParts";
import { Backup } from "./Backup";
import { SongVideoChooser, SongReview, ChangeInfo, SongTitleChooser } from "./SongReview";

/* Mémoire des titres : effet immédiat d'une action sur la liste affichée.
 * Année et langue valent pour toutes les versions (modes) du titre. */
function applySong(list, body) {
  if (!list) return list;
  const id = String(body.key || "").split(":")[1]; // chanson (« w:<chanson>:<version> ») : texte et année valent pour toutes ses versions
  switch (body.action) {
    case "forgetSong": return list.filter((s) => s.key !== body.key);
    case "mergeSongs": return list.filter((s) => !body.keys.includes(s.key)).map((s) => (s.key === body.keep ? { ...s, group: undefined } : s));
    case "ignoreDup": return list.filter((s) => s.group !== body.group);
    case "songText": return list.map((s) => (s.key.split(":")[1] !== id ? s : {
      ...s, fixed: true, ...(body.artist.trim() ? { artist: body.artist.trim() } : {}), ...(body.title.trim() ? { title: body.title.trim() } : {}),
    }));
    case "validateSong": return list.map((s) => (s.key === body.key ? { ...s, validated: !!body.validated } : s));
    case "blindSong": return list.map((s) => (s.key.split(":")[1] === id ? { ...s, blind: !!body.blind } : s)); // étiquette de la chanson
    case "lyricsSong": return list.map((s) => (s.key === body.key ? { ...s, lyrics: !!body.lyrics } : s));
    case "trimVideo": return list.map((s) => (s.videoId === body.videoId && (!body.kind || s.mode === body.kind) ? { ...s, start: body.start || 0, end: body.end ?? null, trimKind: body.kind || null } : s)); // rognage propre à la version
    case "songMeta": return list.map((s) => (s.key.split(":")[1] !== id ? s : {
      ...s, enriched: true,
      ...("year" in body ? { year: parseInt(body.year, 10) || null } : {}),
      ...("fr" in body ? { fr: body.fr } : {}),
    }));
    default: return list;
  }
}

/* Vue par chanson : lignes consécutives d'une même chanson (versions) regroupées. */
function groupByWork(list) {
  const out = [];
  for (const s of list || []) {
    const id = s.workId || s.key;
    const last = out[out.length - 1];
    if (last && last.id === id && s.group === last.rows[0].group) last.rows.push(s);
    else out.push({ id: out.some((g) => g.id === id) ? `${id}#${out.length}` : id, rows: [s] });
  }
  return out;
}
/* Indice de confiance de la recherche automatique (clip officiel…). */
const CONFIDENCE = {
  3: { label: "🎯 sûr", cls: "bg-emerald-100 text-emerald-700" },
  2: { label: "👍 probable", cls: "bg-sky-100 text-sky-700" },
  1: { label: "🤔 incertain", cls: "bg-amber-100 text-amber-700" },
};

/* Mémoire « titre Deezer → vidéo YouTube », à passer en revue : filtres
 * (à vérifier / validés, mode), aperçu de la vidéo retenue, validation,
 * changement de vidéo (repasse « à vérifier »), oubli (le titre sera recherché à
 * nouveau au prochain ajout). */
const STATUS_FILTERS = [["all", "Tous"], ["changes", "🔄 Proposés"], ["todo", "À vérifier"], ["suspect", "🧐 Suspects"], ["dups", "👯 Doublons"], ["missing", "⚠️ À remplacer"], ["ok", "Validés"], ["blind", "🕵️ Blind test"], ["lyrics", "📝 Avec paroles"]];
const SORTS = [["added", "Derniers ajoutés"], ["plays", "Plus joués"], ["rank", "Plus connus"], ["year", "Année"], ["alpha", "A → Z"]];
const LANG_FILTERS = [["", "Toutes langues"], ["fr", "🇫🇷 Français"], ["intl", "🌍 International"], ["unknown", "❓ Langue inconnue"]];
export function SongMemory({ call, total, proposals = 0, focus, enrich, catalog, clips, onChanged }) {
  const [open, setOpen] = useState(true);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [sort, setSort] = useState("added");
  const [editing, setEditing] = useState(null); // clé du titre dont on corrige le texte
  const [openId, setOpenId] = useState(null); // chanson dépliée (vue compacte : une ligne par chanson)
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
  // titres de la revue sortis du filtre en cours de route (vidéo changée : plus « suspect »,
  // validé…) : relus un par un pour que la revue continue sur eux
  const [extra, setExtra] = useState([]);

  const [counts, setCounts] = useState({}); // nombre de titres par filtre (Proposés, À vérifier…)
  const countsTimer = useRef(null);
  const loadCounts = useCallback(() => {
    clearTimeout(countsTimer.current);
    countsTimer.current = setTimeout(async () => {
      try {
        const res = await fetch("/api/jukebox/super?songCounts=1", { cache: "no-store", headers: { "x-jukebox-super": getSuperToken() || "" } });
        if (res.ok) setCounts(await res.json());
      } catch (e) { /* compteurs facultatifs */ }
    }, 1500);
  }, []);
  useEffect(() => () => clearTimeout(countsTimer.current), []);

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
      setExtra([]); // relus ci-dessous s'ils manquent (état à jour)
      setErr("");
      loadCounts();
    } catch (e) {
      setErr(e.message);
    }
  }, [q, status, mode, lang, decade, sort, loadCounts]);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [open, load]);

  // revue ouverte : titres de la revue absents de la liste (sortis du filtre) relus par leur clé
  const reviewKeys = review?.keys;
  useEffect(() => {
    if (!reviewKeys || !songs) return;
    const missing = reviewKeys.filter((k) => !songs.some((s) => s.key === k) && !extra.some((s) => s.key === k));
    if (!missing.length) return;
    let gone = false;
    (async () => {
      try {
        const qs = new URLSearchParams({ songs: "1", status: "all", keys: missing.slice(0, 200).join(",") });
        const res = await fetch(`/api/jukebox/super?${qs}`, { cache: "no-store", headers: { "x-jukebox-super": getSuperToken() || "" } });
        const d = await res.json();
        if (!gone && res.ok) setExtra((list) => [...list.filter((x) => !d.songs.some((n) => n.key === x.key)), ...d.songs]);
      } catch (e) { /* titre affiché comme introuvable */ }
    })();
    return () => { gone = true; };
  }, [reviewKeys, songs]); // eslint-disable-line react-hooks/exhaustive-deps

  // Effet affiché dès le clic, actions envoyées dans l'ordre ; la liste n'est
  // pas relue après chaque action (un titre validé reste visible jusqu'au
  // prochain changement de filtre, sans décaler les lignes sous la souris).
  const run = async (body, confirmText) => {
    if (confirmText && !confirm(confirmText)) return;
    lastAct.current = Date.now();
    setSongs((list) => applySong(list, body));
    setExtra((list) => applySong(list, body));
    const p = queue.current.then(() => call("POST", body));
    queue.current = p.catch(() => {});
    try {
      await p;
      loadCounts();
      if (["forgetSong", "mergeSongs"].includes(body.action)) onChanged?.(); // nombre de titres en mémoire
      if (body.action === "mergeSongs") load(); // versions reprises par la chanson gardée
    } catch (e) { alert(e.message); lastAct.current = Date.now(); load(); }
  };
  // version manquante cherchée ou reprise d'une autre version : liste relue
  const versionAct = async (body, confirmText) => {
    if (confirmText && !confirm(confirmText)) return;
    try { await call("POST", body); await load(); onChanged?.(); } catch (e) { alert(e.message); }
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
        const step = (d.done || 0) + (d.isrc?.done || 0);
        total += step;
        setEnriching({ done: total, pending: d.pending });
        load();
        if (!d.pending || !step) break;
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
          {catalog && !catalog.works && <CatalogMigration catalog={catalog} call={call} onDone={onChanged} />}{/* migration faite : encadré masqué */}
          {clips?.missing > 0 && <ClipScan clips={clips} call={call} onDone={() => { onChanged?.(); load(); }} />}
          {(enrich > 0 || enriching) && (
            <div className="flex flex-wrap items-center gap-3 text-xs bg-sky-50 text-sky-800 rounded-xl px-3 py-2">
              <span>🔎 {enrich} ligne{enrich > 1 ? "s" : ""} à compléter (année, langue ou ISRC) : complétées chaque nuit (Deezer + MusicBrainz, sans quota YouTube).</span>
              {enriching ? (
                <span className="flex items-center gap-2 font-bold">
                  ⏳ {enriching.done} titre{enriching.done > 1 ? "s" : ""} complété{enriching.done > 1 ? "s" : ""}{enriching.pending != null ? `, ${enriching.pending} ligne${enriching.pending > 1 ? "s" : ""} restante${enriching.pending > 1 ? "s" : ""}` : ""}…
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
            const main = (songs || []).filter((s) => !s.sibling); // lignes du filtre (sans les autres versions ajoutées pour la vue par chanson)
            // à vérifier : trouvailles automatiques les plus sûres d'abord (🎯, 👍, 🤔), sinon l'ordre de la liste
            const todo = main.filter((s) => !s.validated && !s.missing)
              .map((s, k) => [s, k]).sort((x, y) => (y[0].confidence || 0) - (x[0].confidence || 0) || x[1] - y[1]).map(([s]) => s);
            const shown = main.filter((s) => !s.missing);
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
              {STATUS_FILTERS.map(([id, label]) => {
                const n = counts[id] || 0; // compteur : seulement sur les filtres « à traiter »
                return (
                  <button key={id} onClick={() => setStatus(id)}
                    className={`px-3 py-1 rounded-full font-bold ${status === id ? "bg-fuchsia-600 text-white" : n ? "text-gray-900 hover:text-fuchsia-700" : "text-gray-500 hover:text-gray-900"}`}>
                    {label}{n > 0 && <span className={`ml-1 font-black ${status === id ? "" : "text-fuchsia-600"}`}>({n})</span>}
                  </button>
                );
              })}
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
            <SongReview review={review} setReview={setReview} songs={[...(songs || []), ...extra.filter((e) => !songs?.some((s) => s.key === e.key))]} run={run} changeRun={changeRun} call={call} editYear={editYear}
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
            <ul className="space-y-3">
              {groupByWork(songs).map((g, gi, all) => {
                const head = g.rows[0];
                const rowOf = (kind) => g.rows.find((x) => x.mode === kind);
                const prevGroup = all[gi - 1]?.rows[0]?.group;
                const reviewFrom = (key) => {
                  const keys = songs.filter((x) => !x.missing).map((x) => x.key);
                  setPreview(null);
                  setReview({ keys, i: Math.max(0, keys.indexOf(key)) });
                };
                return (<Fragment key={g.id}>
                  {head.group != null && head.group !== prevGroup && (
                    <li className="flex flex-wrap items-center justify-between gap-2 pt-3">
                      <span className="text-xs font-bold text-gray-500 uppercase tracking-wide">👯 Doublons possibles · {head.dupWhy}</span>
                      <button onClick={() => run({ action: "ignoreDup", group: head.group, keys: songs.filter((x) => x.group === head.group).map((x) => x.key) })}
                        className="text-xs font-bold text-gray-500 bg-gray-100 px-3 py-1 rounded-full">Ce ne sont pas des doublons</button>
                    </li>
                  )}
                  {status !== "dups" && openId !== g.id ? (
                  /* ligne compacte : la chanson et l'état de ses versions ; clic → carte complète */
                  <li>
                    <div role="button" tabIndex={0} onClick={() => { setOpenId(g.id); setPreview(null); }}
                      onKeyDown={(e) => { if (e.key === "Enter") { setOpenId(g.id); setPreview(null); } }}
                      className={`w-full flex flex-wrap items-center gap-3 rounded-2xl border px-3 py-2 cursor-pointer hover:border-fuchsia-300 hover:bg-fuchsia-50/30 ${g.rows.some((x) => !x.sibling && !x.validated) ? "border-gray-200" : "border-gray-100"}`}>
                      <img src={`https://i.ytimg.com/vi/${(rowOf("normal") || head).videoId}/default.jpg`} alt="" className="w-14 h-10 object-cover rounded-lg shrink-0" />
                      <div className="flex-1 min-w-[160px]">
                        <p className="font-bold text-sm text-gray-900 leading-snug">{head.artist} – {head.title}</p>
                        <p className="text-[11px] text-gray-400">
                          {[head.year, head.fr === true ? "🇫🇷" : head.fr === false ? "🌍" : null, head.blind ? "🕵️ blind test" : null, head.plays > 0 ? `▶ ${head.plays}×` : null].filter(Boolean).join(" · ")}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {["normal", "clip", "karaoke"].filter((k) => k !== "karaoke" || rowOf(k)).map((k) => {
                          const v = rowOf(k);
                          const st = !v ? ["—", "border border-dashed border-gray-300 text-gray-400", "pas encore trouvée"]
                            : v.missing ? ["⚠️", "bg-red-100 text-red-700", "vidéo disparue"]
                            : v.validated ? ["✓", "bg-green-100 text-green-700", "validée"]
                            : v.suspect?.length ? ["🧐", "bg-orange-100 text-orange-700", `à vérifier : ${v.suspect.join(", ")}`]
                            : ["?", "bg-gray-100 text-gray-600", `à vérifier${v.confidence ? ` (${CONFIDENCE[v.confidence]?.label})` : ""}`];
                          return <span key={k} title={`Version ${modeLabel(k)} : ${st[2]}`} className={`text-[11px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${st[1]}`}>{MODE_ICON[k]} {modeLabel(k)} {st[0]}</span>;
                        })}
                      </div>
                      <span className="text-gray-300 text-sm shrink-0">▸</span>
                    </div>
                  </li>
                  ) : (
                  <li className={`border rounded-2xl p-3 space-y-2 ${openId === g.id ? "border-fuchsia-300 shadow-sm" : "border-gray-200"}`}>
                    {status !== "dups" && (
                      <button onClick={() => { setOpenId(null); setPreview(null); }} className="float-right text-xs font-bold text-gray-400 hover:text-gray-700">▾ Replier</button>
                    )}
                    {/* la chanson : texte, année, langue, blind test, écoutes (toutes ses versions) */}
                    <div className="flex flex-wrap items-start gap-2">
                      <div className="flex-1 min-w-[180px]">
                        {editing === head.key ? (
                          <SongTextForm song={head} onCancel={() => setEditing(null)}
                            onSave={(artist, title) => { setEditing(null); run({ action: "songText", key: head.key, artist, title }); }} />
                        ) : (
                          <SongName song={head} onArtist={(a) => { setQ(a); setStatus("all"); }} onTitle={() => setRetitling(head)} onEdit={() => setEditing(head.key)} />
                        )}
                        <div className="flex flex-wrap items-center gap-1.5 mt-1">
                          <button onClick={() => editYear(head)} title="Année de sortie (cliquer pour corriger)"
                            className={`text-[11px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${head.year ? "bg-indigo-100 text-indigo-700" : "bg-gray-100 text-gray-400"}`}>
                            {head.year || (head.enriched ? "année ?" : "…")}
                          </button>
                          <button onClick={() => run({ action: "songMeta", key: head.key, fr: FR_NEXT[String(head.fr)] })}
                            title="Langue (cliquer : français → international → inconnue)"
                            className={`text-[11px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${head.fr === null ? "bg-gray-100 text-gray-400" : "bg-indigo-100 text-indigo-700"}`}>
                            {head.fr === true ? "🇫🇷 Français" : head.fr === false ? "🌍 International" : head.enriched ? "❓ langue" : "…"}
                          </button>
                          <button onClick={() => run({ action: "blindSong", key: head.key, blind: !head.blind })}
                            title={head.blind ? "Retirer du blind test" : "Utiliser dans le blind test (version paroles, sinon clip)"}
                            className={`text-[11px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${head.blind ? "bg-violet-600 text-white" : "bg-gray-100 text-gray-400 hover:text-gray-700"}`}>
                            🕵️ Blind test{head.blind ? "" : " ?"}
                          </button>
                          {head.plays > 0 && <span className="text-[11px] font-bold text-gray-500" title="Joué jusqu'au bout en soirée">▶ joué {head.plays}×</span>}
                        </div>
                      </div>
                      {head.group != null && (
                        <button onClick={() => {
                          const others = songs.filter((x) => x.group === head.group && x.workId !== head.workId);
                          run({ action: "mergeSongs", keep: head.key, keys: others.map((x) => x.key) },
                            `Garder « ${head.artist} – ${head.title} » et y fusionner :\n${others.map((x) => `• ${x.artist} – ${x.title}`).join("\n")}\n\nLes autres fiches Deezer joueront ses vidéos ; leurs versions manquantes sont reprises.`);
                        }} className="text-xs font-bold text-white bg-fuchsia-600 px-3 py-1.5 rounded-full shrink-0">⭐ Garder celui-ci</button>
                      )}
                    </div>
                    {/* ses versions */}
                    {g.rows.map((s) => (
                      <div key={s.key} className={`flex flex-wrap items-center gap-3 rounded-xl px-2 py-2 ${s.sibling ? "bg-gray-50" : "bg-fuchsia-50/50"}`}>
                        <PreviewThumb videoId={s.videoId} active={preview === s.key} onClick={() => setPreview(preview === s.key ? null : s.key)} />
                        <div className="flex-1 min-w-[160px]">
                          <VersionLabel mode={s.mode} />
                          <VideoTitle song={s} className="truncate" />
                          <div className="flex flex-wrap items-center gap-1.5 mt-1">
                            {s.missing
                              ? <span className="text-[11px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap bg-red-100 text-red-700" title="La vidéo n'existe plus ou n'est plus lisible : choisissez-en une autre">⚠️ Vidéo disparue · à remplacer</span>
                              : s.validated
                              ? <span className="text-[11px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap bg-green-100 text-green-700">✓ Validé</span>
                              : <span className="text-[11px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap bg-gray-100 text-gray-500">À vérifier</span>}
                            {!s.validated && !s.missing && s.confidence != null && (
                              <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${CONFIDENCE[s.confidence]?.cls || "bg-gray-100 text-gray-500"}`} title="Indice de confiance de la recherche automatique">{CONFIDENCE[s.confidence]?.label || "?"}</span>
                            )}
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
                          <p className="text-xs text-gray-400 mt-1">{formatDuration(s.duration)} · vérifié le {new Date(s.checkedAt).toLocaleDateString("fr-FR")}</p>
                          <ChangeInfo song={s} run={changeRun} onCompare={() => reviewFrom(s.key)} />
                        </div>
                        <div className="flex flex-wrap gap-1.5 shrink-0">
                          {!s.missing && (
                            <button onClick={() => reviewFrom(s.key)} title="Ouvrir ce titre dans la revue (vérifier, rogner la vidéo…), puis continuer avec les suivants de la liste"
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
                          <button onClick={() => run({ action: "forgetSong", key: s.key }, `Oublier la version ${modeLabel(s.mode)} de « ${s.label || s.key} » ?\nElle sera recherchée à nouveau au prochain ajout.`)}
                            className="text-xs font-bold text-red-600 bg-red-50 px-3 py-1.5 rounded-full">Oublier</button>
                        </div>
                        {preview === s.key && (
                          <div className="w-full max-w-xl"><VideoPreview videoId={s.videoId} onClose={() => setPreview(null)} /></div>
                        )}
                      </div>
                    ))}
                    {/* versions manquantes (paroles, clip ; le karaoké n'est cherché que dans une soirée karaoké) */}
                    {status !== "dups" && head.workId && ["normal", "clip"].filter((k) => !rowOf(k)).map((kind) => {
                      const from = rowOf("normal") || rowOf("clip");
                      return (
                        <div key={kind} className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-gray-300 px-3 py-2 text-xs">
                          <VersionLabel mode={kind} className="opacity-60" />
                          <span className="text-gray-500">pas encore trouvée{kind === "clip" ? " (cherchée chaque matin après le pré-remplissage)" : ""}</span>
                          <button onClick={() => versionAct({ action: "searchVersion", key: head.key, kind }, `Chercher la version ${modeLabel(kind)} de « ${head.artist} – ${head.title} » maintenant ?\n\n1 recherche YouTube sur le quota du jour.`)}
                            className="font-bold bg-white border border-gray-200 px-3 py-1 rounded-full">🔎 Chercher</button>
                          {from && from.mode !== kind && !from.missing && (
                            <button onClick={() => versionAct({ action: "copyVersion", key: from.key, kind }, `Pas de ${kind === "clip" ? "clip officiel" : "version paroles"} : utiliser la même vidéo que la version ${modeLabel(from.mode)} ?\n\nElle sera validée pour la version ${modeLabel(kind)}.`)}
                              className="font-bold bg-white border border-gray-200 px-3 py-1 rounded-full">= Même vidéo que {modeLabel(from.mode)}</button>
                          )}
                        </div>
                      );
                    })}
                  </li>
                  )}
                </Fragment>);
              })}
            </ul>
          )}
          {songs?.filter((s) => !s.sibling).length === 200 && <p className="text-xs text-gray-400 text-center">200 premiers titres affichés : affinez avec les filtres ou la recherche.</p>}
          <Backup call={call} onImported={() => { load(); onChanged?.(); }} />
        </div>
      )}
    </div>
  );
}

/* Refonte du catalogue (SQL v28) : migration de l'ancienne table vers
 * chansons / fiches Deezer / versions, relançable, avec compte rendu. */
function CatalogMigration({ catalog, call, onDone }) {
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState(null);
  const run = async (fresh) => {
    if (!confirm(fresh
      ? "Vider le nouveau catalogue et le refaire entièrement depuis l'ancien ?\n\nÀ faire seulement au moment de la bascule : ce qui a été modifié dans le nouveau catalogue serait perdu."
      : "Copier le catalogue actuel vers le nouveau modèle (chansons / versions) ?\n\nL'ancien catalogue n'est pas modifié. Relançable sans risque.")) return;
    setBusy(true);
    try {
      const d = await call("POST", { action: "migrateCatalog", fresh: !!fresh });
      setReport(d.report);
      onDone?.();
    } catch (e) { alert(e.message); } finally { setBusy(false); }
  };
  const done = catalog.works > 0;
  return (
    <div className="text-xs bg-indigo-50 text-indigo-900 rounded-xl px-3 py-2 space-y-1">
      <div className="flex flex-wrap items-center gap-3">
        <span>🧱 <b>Nouveau catalogue</b> (chansons / versions) : {done ? <>{catalog.works} chanson{catalog.works > 1 ? "s" : ""}, {catalog.versions} version{catalog.versions > 1 ? "s" : ""} (ancien catalogue : {catalog.oldVersions} lignes)</> : "pas encore rempli"}.</span>
        <button onClick={() => run(false)} disabled={busy} className="font-bold bg-indigo-600 text-white px-3 py-1 rounded-full disabled:opacity-50">{busy ? "Migration…" : done ? "Relancer la migration" : "Migrer le catalogue"}</button>
      </div>
      {report && (
        <p>
          ✅ {report.oldRows} lignes lues ({report.oldAliases} fiches rattachées) → {report.songs} chansons
          ({report.newSongs} nouvelles, {report.alreadyMigrated} déjà migrées) ; total : {report.totals.works} chansons, {report.totals.aliases} fiches Deezer, {report.totals.versions} versions.
          {report.conflicts > 0 && <> ⚠️ {report.conflicts} version{report.conflicts > 1 ? "s" : ""} en double (même chanson, même mode) : la ligne gardée l'emporte.</>}
          {report.changesConverted > 0 && <> {report.changesConverted} proposition{report.changesConverted > 1 ? "s" : ""} de changement reprise{report.changesConverted > 1 ? "s" : ""}.</>}
          {report.dupPairsConverted > 0 && <> {report.dupPairsConverted} paire{report.dupPairsConverted > 1 ? "s" : ""} « pas des doublons » reprise{report.dupPairsConverted > 1 ? "s" : ""}.</>}
        </p>
      )}
    </div>
  );
}

/* Clips manquants : cherchés chaque matin après le pré-remplissage ; à la main,
 * quelques-uns sur le quota du jour. */
const SCAN_STOP = { done: "liste terminée", empty: "rien à chercher", time: "temps écoulé", quota: "quota YouTube atteint", error: "erreur" };
function ClipScan({ clips, call, onDone }) {
  const [n, setN] = useState(5);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState(null);
  const run = async () => {
    if (!confirm(`Chercher le clip de ${n} chanson${n > 1 ? "s" : ""} maintenant ?\n\nJusqu'à ${n} recherche${n > 1 ? "s" : ""} YouTube sur le quota du jour (≈ 100 par jour, partagé avec les soirées).`)) return;
    setBusy(true);
    try {
      const d = await call("POST", { action: "scanClips", max: n });
      setReport(d.report);
      onDone?.();
    } catch (e) { alert(e.message); } finally { setBusy(false); }
  };
  const last = report || clips.last;
  return (
    <div className="text-xs bg-emerald-50 text-emerald-900 rounded-xl px-3 py-2 space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <span>🎬 <b>{clips.missing} chanson{clips.missing > 1 ? "s" : ""} sans version clip</b> : cherchées chaque matin après le pré-remplissage, avec le reste du quota.</span>
        <select value={n} onChange={(e) => setN(Number(e.target.value))} className="border border-emerald-300 rounded-full px-2 py-0.5 bg-white">
          {[1, 3, 5, 10, 20].map((x) => <option key={x} value={x}>{x}</option>)}
        </select>
        <button onClick={run} disabled={busy} className="font-bold bg-emerald-600 text-white px-3 py-1 rounded-full disabled:opacity-50">{busy ? "Recherche…" : "Chercher maintenant"}</button>
      </div>
      {last && <p>Dernier passage {new Date(last.at).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} : {last.found} trouvé{last.found > 1 ? "s" : ""}{last.failed ? `, ${last.failed} sans résultat` : ""} ({SCAN_STOP[last.stop] || last.stop}). Les trouvailles sont « À vérifier » (filtre Version Clip).</p>}
    </div>
  );
}
