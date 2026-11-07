"use client";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { getSuperToken } from "../storage";
import { VideoPreview, PreviewThumb } from "../Controls";
import { SEARCH_MODES, formatDuration } from "@/lib/jukebox";
import { DECADES, decadeLabel } from "@/lib/jukeboxBlind";
import { FR_NEXT, MODE_TAG, MODE_ICON, modeLabel, SearchInput, VersionLabel } from "./shared";
import { VideoTitle, SongName, SongTextForm, BlindTag, BlindStat, YearSuggest } from "./SongParts";
import { Backup } from "./Backup";
import { SongVideoChooser, SongReview, ChangeInfo, SongTitleChooser, ReportInfo } from "./SongReview";
import { BlindReview } from "./BlindReview";
import { LinkQueue } from "./LinkQueue";
import { FrFlag } from "../FrFlag";

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
    case "validateSong": return list.map((s) => (s.key === body.key ? { ...s, validated: !!body.validated, ...(body.validated ? { reports: undefined } : {}) } : s)); // validée : signalements traités
    case "blindSong": return list.map((s) => (s.key.split(":")[1] === id ? { ...s, blind: !!body.blind } : s)); // étiquette de la chanson
    case "answerYear": return list.map((s) => (s.key.split(":")[1] !== id ? s : { ...s, year: body.accept && s.yearSuggest ? s.yearSuggest : s.year, yearSuggest: null }));
    case "closeReports": return list.map((s) => (s.key === body.key ? { ...s, reports: undefined } : s));
    case "blindDecide": return list.map((s) => (s.key.split(":")[1] === id ? { ...s, blind: body.level > 0, difficulty: body.level === 2 ? 2 : 0, blindDecided: true, rerank: null } : s));
    case "lyricsSong": return list.map((s) => (s.key === body.key ? { ...s, lyrics: !!body.lyrics } : s));
    case "trimVideo": return list.map((s) => (s.videoId === body.videoId && (!body.kind || s.mode === body.kind) ? { ...s, start: body.start || 0, end: body.end ?? null, trimKind: body.kind || null } : s)); // rognage propre à la version
    case "songMeta": return list.map((s) => (s.key.split(":")[1] !== id ? s : {
      ...s, enriched: true,
      ...("year" in body ? { year: parseInt(body.year, 10) || null, yearSuggest: null } : {}),
      ...("fr" in body ? { fr: body.fr } : {}),
    }));
    default: return list;
  }
}

const ACTIVE = "border-fuchsia-500 bg-fuchsia-50 text-fuchsia-800"; // menu de filtre actif : bien visible

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
/* Provenance de la vidéo retenue (jukebox_versions.source). */
const SOURCE = {
  guest: "invité en soirée",
  regie: "régie en soirée",
  link: "lien YouTube en soirée",
  prefill: "pré-remplissage",
  scan: "scan auto des clips",
  manual: "super-admin",
  copy: "copie d'une autre version",
  search: "recherche auto (invité, régie ou pré-remplissage)",
  migration: "origine inconnue (avant le 03/11/2026)",
};
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
/* Files « À traiter », de la plus urgente à la moins urgente. blind : revue
 * blind test (une décision par chanson) ; list : traitée dans la liste. */
const QUEUES = [
  { id: "reports", label: "🚩 Signalements", help: "Problèmes signalés par la régie pendant une soirée (pas la bonne chanson, mauvaise version, temps mort…). Seulement les vidéos déjà validées : celles pas encore vérifiées restent dans « Versions à valider », avec le signalement affiché dans la revue. Corrigez (vidéo, rognage, texte…) puis ✓ Traité ou ✕ Pas d'accord." },
  { id: "missing", label: "⚠️ Vidéos disparues", help: "Vidéos qui n'existent plus ou ne sont plus lisibles : choisissez-en une autre (Remplacer la vidéo) avant la prochaine soirée." },
  { id: "changes", label: "🔄 Proposés en soirée", help: "« Mauvaise vidéo ? » utilisé en soirée sur des titres déjà vérifiés : la soirée a changé de vidéo, la mémoire non. Comparez puis adoptez la vidéo proposée (pour toutes les soirées) ou gardez l'actuelle." },
  { id: "todo", label: "🎬 Versions à valider", help: "Vidéos trouvées automatiquement, pas encore vérifiées : les suspectes d'abord (durée, titre absent, live, reprise…), puis les trouvailles les plus sûres. Validez, rognez ou changez la vidéo." },
  { id: "links", label: "🔗 Ajoutés par lien", list: true, help: "Vidéos ajoutées par lien YouTube en soirée : hors mémoire (pas de fiche Deezer), elles ne profitent ni de la validation, ni du rognage, ni du blind test. Ajoutez-les à la mémoire en choisissant la chanson, ou ignorez-les (pas une chanson, sans intérêt)." },
  { id: "dups", label: "👯 Doublons", list: true, help: "Chansons qui se ressemblent (même vidéo, même ISRC, ou interprète et titre proches). « Garder celui-ci » fusionne le groupe : écoutes, étiquettes, versions et fiches Deezer sont regroupées sur la chanson gardée." },
  { id: "blindq", label: "🕵️ Blind test à décider", blind: true, help: "Chansons dont la place au blind test n'est pas encore décidée : pas au blind, oui, ou oui difficile. Les « oui » d'avant (déjà joués en soirée) d'abord, à confirmer. Une décision, et la chanson suivante." },
  { id: "rerank", label: "📊 Blind à reclasser", blind: true, help: "D'après les réponses des invités reçues depuis votre décision (au moins 8) : difficulté normale mais trouvé par moins d'1 joueur sur 4, ou difficile mais trouvé par 7 sur 10 ou plus. Reclassez, ou gardez : seules les réponses suivantes compteront." },
  { id: "yearq", label: "📅 Années à vérifier", list: true, help: "L'année trouvée vient parfois d'une réédition (remaster, compilation) : la vérification a trouvé une sortie plus ancienne. Acceptez-la (✓), gardez l'année actuelle (✕, plus reproposée), ou cliquez l'année pour en taper une autre." },
  { id: "meta", label: "📅 Année ou langue manquante", help: "Chansons enrichies sans année ou sans langue trouvée (filtres du blind test et du catalogue invités) : cliquez l'année ou la langue pour la renseigner." },
];
const VERSION_FILTERS = [["all", "Toutes les vidéos"], ["todo", "Vidéos à vérifier"], ["ok", "Vidéos validées"], ["lyrics", "📝 Avec paroles"], ["missing", "⚠️ Vidéos disparues"]];
const BLIND_FILTERS = [["", "Blind test : tous"], ["undecided", "🕵️ À décider"], ["yes", "🕵️ Oui"], ["hard", "🎓 Difficile"], ["no", "Pas au blind"]];
/* Tri : critère + sens (bouton à côté) ; libellés du sens selon le critère : [normal, inversé]. */
const SORTS = [["added", "Date d'ajout"], ["plays", "Écoutes"], ["rank", "Popularité"], ["year", "Année"], ["alpha", "Alphabétique"]];
const SORT_DIR = {
  added: ["↓ Récents d'abord", "↑ Anciens d'abord"],
  plays: ["↓ Plus joués d'abord", "↑ Moins joués d'abord"],
  rank: ["↓ Plus connus d'abord", "↑ Moins connus d'abord"],
  year: ["↑ Plus anciens d'abord", "↓ Plus récents d'abord"],
  alpha: ["A → Z", "Z → A"],
};
const LANG_FILTERS = [["", "Toutes langues"], ["fr", "Français"], ["intl", "🌍 International"], ["unknown", "❓ Langue inconnue"]];
export function SongMemory({ call, total, proposals = 0, focus, enrich, night, catalog, years, onChanged }) {
  const [open, setOpen] = useState(true);
  const [q, setQ] = useState("");
  const [view, setView] = useState("todo"); // todo : files à vider ; catalog : exploration
  const [status, setStatus] = useState("todo");
  const [blind, setBlind] = useState(""); // catalogue : filtre blind test
  const [sort, setSort] = useState("added");
  const [sortRev, setSortRev] = useState(false); // sens inversé (bouton à côté du tri)
  const [editing, setEditing] = useState(null); // clé du titre dont on corrige le texte
  const [openId, setOpenId] = useState(null); // chanson dépliée (vue compacte : une ligne par chanson)
  // tuile « Titres en mémoire » : liste complète, sans filtre
  useEffect(() => {
    if (!focus) return;
    setOpen(true);
    setView("catalog");
    setStatus("all");
    setBlind("");
    setQ("");
    setLang("");
    setDecade("");
    setSource("");
  }, [focus]);
  const [mode, setMode] = useState("");
  const [lang, setLang] = useState("");
  const [decade, setDecade] = useState("");
  const [source, setSource] = useState("");
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
  const [facets, setFacets] = useState(null); // total des titres correspondant aux filtres
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
      const qs = new URLSearchParams({ songs: "1", q, status, mode, lang, decade, sort, ...(source ? { source } : {}), ...(blind ? { blind } : {}), ...(sortRev ? { rev: "1" } : {}) });
      const res = await fetch(`/api/jukebox/super?${qs}`, {
        cache: "no-store", headers: { "x-jukebox-super": getSuperToken() || "" },
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Chargement impossible.");
      if (started < lastAct.current) return;
      setSongs(d.songs);
      setExtra([]); // relus ci-dessous s'ils manquent (état à jour)
      if (status !== "dups") fetch(`/api/jukebox/super?${new URLSearchParams({ facets: "1", q, status, mode, lang, decade, ...(source ? { source } : {}), ...(blind ? { blind } : {}) })}`, {
        cache: "no-store", headers: { "x-jukebox-super": getSuperToken() || "" },
      }).then((r) => (r.ok ? r.json() : null)).then((f) => f && setFacets(f)).catch(() => {});
      else setFacets(null);
      setErr("");
      loadCounts();
    } catch (e) {
      setErr(e.message);
    }
  }, [q, status, blind, mode, lang, decade, source, sort, sortRev, loadCounts]);

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
  // correction du texte en cours dans une carte (non enregistrée) : enregistrée d'office
  // dès qu'on fait autre chose (valider, changer de vidéo, replier, ouvrir une autre carte, revue…)
  const draft = useRef(null);
  const commitDraft = () => {
    const d = draft.current;
    draft.current = null;
    if (d && editing) { setEditing(null); run({ action: "songText", key: editing, artist: d.artist, title: d.title }); }
  };
  const run = async (body, confirmText) => {
    if (body.action !== "songText") commitDraft();
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
  const qdef = view === "todo" ? QUEUES.find((x) => x.id === status) : null;
  const todoTotal = QUEUES.reduce((n, x) => n + (counts[x.id] || 0), 0);
  const switchView = (v) => {
    if (v === view) return;
    commitDraft();
    setView(v);
    setOpenId(null);
    setBlind("");
    setStatus(v === "catalog" ? "all" : (QUEUES.find((x) => counts[x.id] > 0) || QUEUES[2]).id);
  };
  // compteurs des files dès l'ouverture
  useEffect(() => { loadCounts(); }, [loadCounts]);
  // vérification des années, à la main : appels successifs (~45 s chacun) jusqu'au bout
  const [checking, setChecking] = useState(false);
  const stopCheck = useRef(false);
  const checkNow = async () => {
    stopCheck.current = false;
    setChecking({ done: 0, suggested: 0 });
    try {
      for (let done = 0, suggested = 0; !stopCheck.current;) {
        const d = await call("POST", { action: "checkYears" });
        done += d.done || 0;
        suggested += d.suggested || 0;
        setChecking({ done, suggested, left: d.left });
        load();
        if (!d.left || !d.done) break;
      }
      onChanged?.();
    } catch (e) { alert(e.message); } finally { setChecking(false); }
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
            Chaque chanson a ses versions (Paroles, Clip, Karaoké), chacune avec sa vidéo YouTube. <b>📥 À traiter</b> : les files à vider, une décision
            à la fois. <b>🔎 Catalogue</b> : tout le reste, pour chercher et corriger au cas par cas.
          </p>
          {catalog && !catalog.works && <CatalogMigration catalog={catalog} call={call} onDone={onChanged} />}{/* migration faite : encadré masqué */}
          {(enrich > 0 || enriching) && (
            <div className="flex flex-wrap items-center gap-3 text-xs bg-sky-50 text-sky-800 rounded-xl px-3 py-2">
              <span>🔎 {enrich} ligne{enrich > 1 ? "s" : ""} à compléter (année, langue ou ISRC) : complétées automatiquement chaque nuit (Deezer + MusicBrainz, sans quota YouTube). Le bouton ne sert que si vous en avez besoin tout de suite.</span>
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
          {night?.at && (
            <p className={`text-xs ${night.error ? "text-amber-700" : "text-gray-500"}`}>
              🌙 Dernier enrichissement, le {new Date(night.at).toLocaleDateString("fr-FR")} : {night.enriched || 0} titre{night.enriched > 1 ? "s" : ""} complété{night.enriched > 1 ? "s" : ""}, {night.years || 0} année{night.years > 1 ? "s" : ""} vérifiée{night.years > 1 ? "s" : ""}{night.suggested ? ` (${night.suggested} à confirmer)` : ""}, {night.rounds || 0} tour{night.rounds > 1 ? "s" : ""}
              {night.stop === "done" ? " : terminé." : night.stop === "rounds" ? ` : limite de tours atteinte, ${night.left} restant${night.left > 1 ? "s" : ""}, repris la nuit suivante.` : night.stop === "stalled" ? ` : arrêté sans progrès, ${night.left} restant${night.left > 1 ? "s" : ""}, repris la nuit suivante.` : night.stop === "relaunch" ? " : relance impossible, repris la nuit suivante." : " : en cours…"}
              {night.error && <> Erreur : {night.error}</>}
            </p>
          )}
          {/* deux écrans : files à vider (À traiter) / exploration (Catalogue) */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex bg-gray-100 rounded-2xl p-0.5 text-sm font-bold">
              <button onClick={() => switchView("todo")} className={`px-4 py-1.5 rounded-xl ${view === "todo" ? "bg-fuchsia-600 text-white" : "text-gray-600 hover:text-gray-900"}`}>
                📥 À traiter{todoTotal > 0 && <span className={`ml-1 ${view === "todo" ? "" : "text-fuchsia-600"}`}>({todoTotal})</span>}
              </button>
              <button onClick={() => switchView("catalog")} className={`px-4 py-1.5 rounded-xl ${view === "catalog" ? "bg-fuchsia-600 text-white" : "text-gray-600 hover:text-gray-900"}`}>🔎 Catalogue</button>
            </div>
          </div>
          {view === "todo" && (
            <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-4">
              {QUEUES.map((qd) => {
                const n = counts[qd.id] || 0;
                const on = status === qd.id;
                return (
                  <button key={qd.id} onClick={() => setStatus(qd.id)}
                    className={`text-left rounded-xl px-3 py-2 border-2 ${on ? "border-fuchsia-500 bg-fuchsia-50" : n ? "border-gray-200 hover:border-fuchsia-300" : "border-gray-100 text-gray-400"}`}>
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="text-sm font-bold">{qd.label}</span>
                      <span className={`text-lg font-black tabular-nums ${n ? "text-fuchsia-600" : "text-gray-300"}`}>{n}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
          {view === "todo" && qdef && <p className="text-xs text-gray-500">{qdef.help}</p>}
          {view === "todo" && status === "yearq" && (years > 0 || checking) && (
            <div className="flex flex-wrap items-center gap-3 text-xs bg-orange-50 text-orange-900 rounded-xl px-3 py-2">
              <span>📅 {checking ? checking.left ?? years : years} chanson{years > 1 ? "s" : ""} pas encore vérifiée{years > 1 ? "s" : ""} : vérifiées chaque nuit (MusicBrainz, sans quota YouTube, ≈ 2 s par chanson).</span>
              {checking ? (
                <span className="flex items-center gap-2 font-bold">
                  ⏳ {checking.done} vérifiée{checking.done > 1 ? "s" : ""}, {checking.suggested} proposition{checking.suggested > 1 ? "s" : ""}…
                  <button onClick={() => { stopCheck.current = true; }} className="underline font-normal">arrêter</button>
                </span>
              ) : (
                <button onClick={checkNow} className="font-bold bg-orange-500 text-white px-3 py-1 rounded-full">Vérifier maintenant</button>
              )}
            </div>
          )}
          {view === "todo" && status === "links" && <LinkQueue call={call} onChanged={() => { loadCounts(); onChanged?.(); }} />}
          {!(view === "todo" && status === "links") && (() => {
            const main = (songs || []).filter((s) => !s.sibling); // lignes du filtre (sans les autres versions ajoutées pour la vue par chanson)
            if (view === "todo") {
              if (!qdef || qdef.list || !main.length) return null; // doublons : directement dans la liste
              let keys = main.filter((s) => !s.missing || status === "missing");
              // versions à valider : suspects d'abord, puis les trouvailles les plus sûres (🎯, 👍, 🤔), puis l'ordre de la liste
              if (status === "todo") keys = keys.map((s, k) => [s, k]).sort((x, y) => (y[0].suspect?.length ? 1 : 0) - (x[0].suspect?.length ? 1 : 0)
                || (y[0].confidence || 0) - (x[0].confidence || 0) || x[1] - y[1]).map(([s]) => s);
              return (
                <button onClick={() => { setPreview(null); setReview({ keys: keys.map((s) => s.key), i: 0, blind: !!qdef.blind, title: qdef.label }); }}
                  className={`text-sm font-bold text-white px-5 py-2 rounded-full ${qdef.blind ? "bg-violet-600 hover:bg-violet-700" : "bg-fuchsia-600 hover:bg-fuchsia-700"}`}>
                  ▶ Commencer ({keys.length}{main.length === 200 ? "+" : ""})
                </button>
              );
            }
            const todo = main.filter((s) => !s.validated && !s.missing)
              .map((s, k) => [s, k]).sort((x, y) => (y[0].confidence || 0) - (x[0].confidence || 0) || x[1] - y[1]).map(([s]) => s);
            const shown = main.filter((s) => !s.missing);
            const list = todo.length ? todo : shown;
            return list.length > 0 && (
              <div className="flex flex-wrap items-center gap-3">
                <button onClick={() => { setPreview(null); setReview({ keys: list.map((s) => s.key), i: 0 }); }}
                  className="text-sm font-bold text-white bg-gray-800 hover:bg-gray-900 px-4 py-1.5 rounded-full">
                  ▶ Revue {todo.length ? `des titres à vérifier affichés (${todo.length})` : `de la liste affichée (${shown.length})`}
                </button>
                <span className="text-xs text-gray-500">Un titre à la fois, avec rognage de la vidéo.</span>
              </div>
            );
          })()}
          <div className={`flex flex-wrap gap-2 items-center ${view === "todo" && status === "links" ? "hidden" : ""}`}>
            {view === "catalog" && (
              <>
                <select value={status} onChange={(e) => setStatus(e.target.value)} className={`border-2 rounded-full px-3 py-1 text-sm font-semibold ${status !== "all" ? ACTIVE : "border-gray-200"}`}>
                  {VERSION_FILTERS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                </select>
                <select value={blind} onChange={(e) => setBlind(e.target.value)} className={`border-2 rounded-full px-3 py-1 text-sm font-semibold ${blind ? ACTIVE : "border-gray-200"}`}>
                  {BLIND_FILTERS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                </select>
              </>
            )}
            <select value={mode} onChange={(e) => setMode(e.target.value)} className={`border-2 rounded-full px-3 py-1 text-sm font-semibold ${mode ? ACTIVE : "border-gray-200"}`}>
              <option value="">Tous les modes</option>
              {SEARCH_MODES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
            <select value={lang} onChange={(e) => setLang(e.target.value)} className={`border-2 rounded-full px-3 py-1 text-sm font-semibold ${lang ? ACTIVE : "border-gray-200"}`}>
              {LANG_FILTERS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
            <select value={decade} onChange={(e) => setDecade(e.target.value)} className={`border-2 rounded-full px-3 py-1 text-sm font-semibold ${decade ? ACTIVE : "border-gray-200"}`}>
              <option value="">Toutes décennies</option>
              {DECADES.map((d) => <option key={d} value={d}>{decadeLabel(d)}</option>)}
              <option value="unknown">❓ Année inconnue</option>
            </select>
            <select value={source} onChange={(e) => setSource(e.target.value)} className={`border-2 rounded-full px-3 py-1 text-sm font-semibold ${source ? ACTIVE : "border-gray-200"}`}>
              <option value="">Toutes provenances</option>
              {Object.entries(SOURCE).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
            {status !== "dups" && status !== "rerank" && (
              <div className="flex items-center border-2 border-gray-200 rounded-full overflow-hidden text-sm font-semibold">
                <select value={sort} onChange={(e) => { setSort(e.target.value); setSortRev(false); }} className="pl-3 pr-1 py-1 bg-transparent outline-none" title="Trier par">
                  {SORTS.map(([id, label]) => <option key={id} value={id}>Tri : {label}</option>)}
                </select>
                <button onClick={() => setSortRev((v) => !v)} title="Inverser l'ordre"
                  className={`px-3 py-1 border-l-2 border-gray-200 whitespace-nowrap hover:bg-fuchsia-50 ${sortRev ? "text-fuchsia-700 bg-fuchsia-50" : "text-gray-600"}`}>
                  {(SORT_DIR[sort] || SORT_DIR.added)[sortRev ? 1 : 0]}
                </button>
              </div>
            )}
            <SearchInput value={q} onChange={setQ} placeholder="Rechercher un artiste, un titre…" className="flex-1 min-w-[180px]" />
            {facets?.total && status !== "dups" && (
              <span className="text-sm font-bold text-gray-500 whitespace-nowrap" title="Titres correspondant aux filtres choisis">
                {facets.total.songs} chanson{facets.total.songs > 1 ? "s" : ""}{facets.total.versions !== facets.total.songs ? ` · ${facets.total.versions} versions` : ""}
              </span>
            )}
          </div>
          {err && <p className="text-sm text-red-600">{err}</p>}
          {review?.blind && (
            <BlindReview review={review} setReview={setReview} title={review.title} songs={[...(songs || []), ...extra.filter((e) => !songs?.some((s) => s.key === e.key))]}
              run={run} editYear={editYear} onClose={() => { setReview(null); load(); }} />
          )}
          {review && !review.blind && (
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
          {view === "todo" && status === "links" ? null : songs === null ? <p className="text-sm text-gray-400">Chargement…</p> : songs.length === 0 ? (
            <p className="text-sm text-gray-400">{view === "todo" ? (q || mode || lang || decade || source ? "Rien dans cette file avec ces filtres." : status === "rerank" ? "Rien à reclasser : pas encore assez de réponses au blind test 👍" : "File vide 🎉") : "Aucun titre."}</p>
          ) : (
            <ul className="space-y-3">
              {groupByWork(songs).map((g, gi, all) => {
                const head = g.rows[0];
                const rowOf = (kind) => g.rows.find((x) => x.mode === kind);
                const prevGroup = all[gi - 1]?.rows[0]?.group;
                const reviewFrom = (key) => {
                  commitDraft();
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
                    <div role="button" tabIndex={0} onClick={() => { if (window.getSelection()?.toString()) return; /* texte sélectionné (copier) : on n'ouvre pas */ commitDraft(); setOpenId(g.id); setPreview(null); }}
                      onKeyDown={(e) => { if (e.key === "Enter") { commitDraft(); setOpenId(g.id); setPreview(null); } }}
                      className={`w-full flex flex-wrap items-center gap-3 rounded-2xl border px-3 py-2 cursor-pointer hover:border-fuchsia-300 hover:bg-fuchsia-50/30 ${g.rows.some((x) => !x.sibling && !x.validated) ? "border-gray-200" : "border-gray-100"}`}>
                      <img src={`https://i.ytimg.com/vi/${(rowOf("normal") || head).videoId}/default.jpg`} alt="" className="w-14 h-10 object-cover rounded-lg shrink-0" />
                      <div className="flex-1 min-w-[160px]">
                        <p className="font-bold text-sm text-gray-900 leading-snug select-text">{head.artist} – {head.title}</p>
                        <p className="text-[11px] text-gray-400">
                          {[head.year, head.fr === true ? <FrFlag key="fr" /> : head.fr === false ? "🌍" : null, head.blind ? `🕵️ blind test${head.difficulty >= 2 ? " 🎓" : ""}${head.blindStat ? ` (trouvé ${head.blindStat.found}/${head.blindStat.n})` : ""}` : null, head.rerank ? <b key="rr" className="text-orange-600">📊 à reclasser</b> : null, g.rows.some((x) => x.reports?.length) ? <b key="rp" className="text-red-600">🚩 signalé</b> : null, head.plays > 0 ? `▶ ${head.plays}×` : null]
                            .filter(Boolean).flatMap((x, k) => (k ? [" · ", x] : [x]))}
                        </p>
                        <YearSuggest song={head} run={run} className="mt-0.5" />
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
                      <button onClick={() => { commitDraft(); setOpenId(null); setPreview(null); }} className="float-right text-xs font-bold text-gray-400 hover:text-gray-700">▾ Replier</button>
                    )}
                    {/* la chanson : texte, année, langue, blind test, écoutes (toutes ses versions) */}
                    <div className="flex flex-wrap items-start gap-2">
                      <div className="flex-1 min-w-[180px]">
                        {editing === head.key ? (
                          <SongTextForm song={head} draftRef={draft} onCancel={() => { draft.current = null; setEditing(null); }}
                            onSave={(artist, title) => { setEditing(null); run({ action: "songText", key: head.key, artist, title }); }} />
                        ) : (
                          <SongName song={head} onArtist={(a) => { setQ(a); setStatus("all"); }} onTitle={() => setRetitling(head)} onEdit={() => setEditing(head.key)} />
                        )}
                        <div className="flex flex-wrap items-center gap-1.5 mt-1">
                          <button onClick={() => editYear(head)} title="Année de sortie (cliquer pour corriger)"
                            className={`text-[11px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${head.year ? "bg-indigo-100 text-indigo-700" : "bg-gray-100 text-gray-400"}`}>
                            {head.year || (head.enriched ? "année ?" : "…")}
                          </button>
                          <YearSuggest song={head} run={run} />
                          <button onClick={() => run({ action: "songMeta", key: head.key, fr: FR_NEXT[String(head.fr)] })}
                            title="Langue (cliquer : français → international → inconnue)"
                            className={`text-[11px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${head.fr === null ? "bg-gray-100 text-gray-400" : "bg-indigo-100 text-indigo-700"}`}>
                            {head.fr === true ? <><FrFlag /> Français</> : head.fr === false ? "🌍 International" : head.enriched ? "❓ langue" : "…"}
                          </button>
                          <BlindTag song={head} onLevel={(level) => run({ action: "blindDecide", key: head.key, level })} />
                          <BlindStat song={head} run={run} />
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
                          <p className="text-xs text-gray-400 mt-1">{formatDuration(s.duration)}{s.createdAt && <> · ajouté le {new Date(s.createdAt).toLocaleDateString("fr-FR")}</>}{s.source && <> · {SOURCE[s.source] || s.source}</>}{s.sourceSession && <> ({s.sourceSession})</>} · vérifié le {new Date(s.checkedAt).toLocaleDateString("fr-FR")}</p>
                          <ChangeInfo song={s} run={changeRun} onCompare={() => reviewFrom(s.key)} />
                          <ReportInfo song={s} run={run} />
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
                          <button onClick={() => { commitDraft(); setFixing(s); }} className={`text-xs font-bold px-3 py-1.5 rounded-full ${s.missing ? "bg-red-600 text-white" : "bg-gray-100"}`}>
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
                          <span className="text-gray-500">pas encore trouvée</span>
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

