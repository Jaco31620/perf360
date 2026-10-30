"use client";
/*
 * Jukebox — super-admin (/jukebox/admin), mot de passe de Clic-Clac :
 * toutes les soirées (activité, suppression prévue), accès à leur régie,
 * nouveau lien régie, suppression ; réglages de conservation et de création ;
 * recherches YouTube du jour ; mémoire des titres (recherche, oubli) et
 * son pré-remplissage (titres cherchés par le cron de 6 h).
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import PasswordInput from "@/components/PasswordInput";
import ChangePasswordForm from "@/components/ChangePasswordForm";
import { getSuperToken, setSuperToken, setAdminToken, rememberParty, formatCode } from "./storage";
import { VideoChooser, VideoPreview, PreviewThumb } from "./Controls";
import { MAX_NAME_LEN, MAX_CHOICES, SEARCH_MODES, FADE_CHOICES, AUTHOR_REVEAL_CHOICES, FEATURES, THEMES, SOIREE_DEFAULTS, maxLabel, formatDuration } from "@/lib/jukebox";
import { BLIND_MODES, BLIND_REVEAL_CHOICES, BLIND_AFTER_CHOICES } from "@/lib/jukeboxBlind";

const RETENTION_CHOICES = [1, 2, 3, 7, 14, 30];
const CREATION_MODES = [
  { id: "open", label: "Tout le monde", hint: "Toute personne qui connaît l'adresse /jukebox peut créer une soirée." },
  { id: "code", label: "Avec un code", hint: "Il faut saisir le code de création ci-dessous." },
  { id: "super", label: "Super-admin seul", hint: "Vous créez les soirées ici et transmettez le lien régie." },
];
const SEARCH_QUOTA = 100; // ~10 000 unités / jour, 100 par recherche
const QUOTA_NOTE = "Remise à zéro chaque jour à minuit heure du Pacifique (8 h ou 9 h à Paris selon la saison). Les recherches déjà faites et les liens collés ne comptent pas. Avec Deezer, seul l'ajout d'un titre jamais choisi compte.";

const fmtDate = (ms) => new Date(ms).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
function fmtIn(ms) {
  const d = ms - Date.now();
  if (d <= 0) return "à la prochaine purge";
  const h = Math.round(d / 3600e3);
  return h < 48 ? `dans ${h} h` : `dans ${Math.round(h / 24)} j`;
}
const randomCode = () => Array.from({ length: 6 }, () => "ABCDEFGHJKMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 31)]).join("");

export default function SuperAdmin() {
  const [token, setToken] = useState(undefined);
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [data, setData] = useState(null);
  const [origin, setOrigin] = useState("");
  const [link, setLink] = useState(null); // { name, url } lien régie à transmettre
  const [filter, setFilter] = useState("");
  const [focus, setFocus] = useState(null); // { on: "memory" | "queue", at } : tuile cliquée
  const goTo = (on) => { chooseTab(on); setFocus({ on, at: Date.now() }); };
  const [tab, setTab] = useState("soirees"); // onglet retenu par appareil
  useEffect(() => { try { const t = localStorage.getItem("jukebox:superTab"); if (["soirees", "reglages", "memory", "queue"].includes(t)) setTab(t); } catch (e) { /* ignoré */ } }, []);
  const chooseTab = (t) => { setTab(t); try { localStorage.setItem("jukebox:superTab", t); } catch (e) { /* ignoré */ } };
  const matches = (s) => {
    const q = filter.trim().toLowerCase();
    return !q || s.name.toLowerCase().includes(q) || s.code.includes(q.replace(/\s/g, ""));
  };

  useEffect(() => { setToken(getSuperToken()); setOrigin(window.location.origin); }, []);

  const call = useCallback(async (method, body) => {
    const res = await fetch("/api/jukebox/super", {
      method, cache: "no-store",
      headers: { "Content-Type": "application/json", "x-jukebox-super": token || "" },
      body: body ? JSON.stringify(body) : undefined,
    });
    const d = await res.json().catch(() => ({}));
    if (res.status === 401) { setSuperToken(null); setToken(null); throw new Error("Session expirée."); }
    if (!res.ok) throw new Error(d.error || "Action impossible.");
    return d;
  }, [token]);

  const load = useCallback(async () => {
    if (!token) return;
    try { setData(await call("GET")); } catch (e) { /* géré par call */ }
  }, [token, call]);
  useEffect(() => { load(); }, [load]);

  const login = async (e) => {
    e.preventDefault();
    setErr("");
    const res = await fetch("/api/jukebox/super/login", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: pw }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) return setErr(d.error || "Connexion impossible.");
    setSuperToken(d.token);
    setToken(d.token);
    setPw("");
  };

  const action = async (body, confirmText) => {
    if (confirmText && !confirm(confirmText)) return null;
    try { const d = await call("POST", body); await load(); return d; } catch (e) { alert(e.message); return null; }
  };

  if (token === undefined) return null;
  if (!token) {
    return (
      <Page>
        <form onSubmit={login} className="max-w-sm mx-auto bg-white rounded-3xl shadow-xl p-7 mt-10 space-y-4">
          <h1 className="text-xl font-black">Super-admin Jukebox</h1>
          <p className="text-sm text-gray-500">Même mot de passe que le super-admin Clic-Clac.</p>
          <PasswordInput autoFocus value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Mot de passe"
            className="w-full border-2 border-gray-200 rounded-xl px-4 py-3 focus:border-fuchsia-500 outline-none" />
          {err && <p className="text-red-600 text-sm">{err}</p>}
          <button className="w-full bg-gray-900 text-white font-bold py-3 rounded-full">Se connecter</button>
        </form>
      </Page>
    );
  }

  const cfg = data?.config;
  const nSessions = data?.sessions.length ?? 0;
  const tabs = [
    { id: "soirees", label: `🎉 Soirées${nSessions ? ` (${nSessions})` : ""}` },
    { id: "reglages", label: "⚙️ Réglages" },
  ];
  const quotaPct = data ? Math.min(100, (data.searches / SEARCH_QUOTA) * 100) : 0;

  return (
    <Page>
      <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-fuchsia-600">Super-admin</p>
          <h1 className="text-3xl font-black text-gray-900">Jukebox</h1>
        </div>
        <button onClick={() => { setSuperToken(null); setToken(null); }} className="text-sm text-gray-400 underline">Se déconnecter</button>
      </div>

      {data && (
        <div className="grid grid-cols-3 gap-3 mb-4">
          <Stat label="Recherches YouTube aujourd'hui" value={`${data.searches} / ~${SEARCH_QUOTA}`} title={QUOTA_NOTE}>
            <div className="h-1.5 bg-gray-100 rounded-full mt-2 overflow-hidden">
              <div className={`h-full ${quotaPct >= 80 ? "bg-red-500" : "bg-fuchsia-500"}`} style={{ width: `${quotaPct}%` }} />
            </div>
          </Stat>
          <Stat label="🎵 Titres en mémoire" value={data.songs} active={tab === "memory"} onClick={() => goTo("memory")} />
          <Stat label="🌅 En attente de pré-remplissage" value={data.prefill?.pending ?? 0} active={tab === "queue"} onClick={() => goTo("queue")} />
        </div>
      )}

      <div className="flex bg-white border border-purple-100 rounded-full p-1 mb-4 w-full sm:w-fit">
        {tabs.map((t) => (
          <button key={t.id} onClick={() => chooseTab(t.id)}
            className={`flex-1 sm:flex-none px-4 py-2 rounded-full font-bold text-sm whitespace-nowrap ${tab === t.id ? "bg-fuchsia-600 text-white" : "text-gray-500 hover:text-gray-900"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "soirees" && (
        <>
          <CreateForm token={token} defaults={cfg?.defaultFeatures} defaultOptions={cfg?.defaultOptions} onCreated={(code, adminToken, name) => {
            setAdminToken(code, adminToken);
            rememberParty(code, name);
            setLink({ name, url: `${origin}/jukebox/${code}/regie#t=${adminToken}`, joinUrl: `${origin}/jukebox/${code}` });
            load();
          }} />
          {link && <LinkBox {...link} onClose={() => setLink(null)} />}
          {nSessions > 5 && (
            <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Rechercher une soirée (nom ou code)"
              className="mt-4 w-full border-2 border-gray-200 bg-white rounded-full px-4 py-2 text-sm focus:border-fuchsia-500 outline-none" />
          )}
          <div className="space-y-3 mt-4">
            {data && nSessions === 0 && <p className="text-gray-400 text-center py-10">Aucune soirée.</p>}
            {data?.sessions.filter(matches).map((s) => (
              <div key={s.code} className="bg-white rounded-2xl border border-purple-100 p-4 flex flex-wrap items-center gap-x-5 gap-y-2">
                <div className="flex-1 min-w-[220px]">
                  <p className="font-bold text-gray-900">{s.name} <span className="font-mono text-fuchsia-600 text-sm ml-1">{formatCode(s.code)}</span></p>
                  <p className="text-xs text-gray-500">
                    Créée le {fmtDate(Date.parse(s.createdAt))} · dernière activité {fmtDate(s.lastActivity)} · {s.played} titre{s.played > 1 ? "s" : ""} joué{s.played > 1 ? "s" : ""}, {s.queued} en attente
                  </p>
                  <p className="text-xs text-gray-400">Suppression automatique {fmtIn(s.expiresAt)}</p>
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {FEATURES.map((f) => {
                      const on = s.features?.[f.id];
                      return (
                        <button key={f.id} title={`${f.hint}\nCliquer pour ${on ? "désactiver" : "activer"}.`}
                          onClick={() => action({ action: "features", code: s.code, features: { [f.id]: !on } })}
                          className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${on ? "bg-fuchsia-100 text-fuchsia-700" : "bg-gray-100 text-gray-400 line-through"}`}>
                          {f.icon} {f.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 text-sm">
                  <Link href={`/jukebox/${s.code}/regie`} target="_blank" className="font-bold bg-gray-900 text-white px-3 py-1.5 rounded-full">Régie</Link>
                  <Link href={`/jukebox/${s.code}/ecran`} target="_blank" className="font-bold bg-gray-100 px-3 py-1.5 rounded-full">Écran</Link>
                  <button onClick={async () => {
                    const d = await action({ action: "regie", code: s.code }, `Créer un nouveau lien régie pour « ${s.name} » ?\nL'ancien lien régie ne fonctionnera plus.`);
                    if (d?.adminToken) { setAdminToken(s.code, d.adminToken); setLink({ name: s.name, url: `${origin}/jukebox/${s.code}/regie#t=${d.adminToken}`, joinUrl: `${origin}/jukebox/${s.code}` }); }
                  }} className="font-bold bg-gray-100 px-3 py-1.5 rounded-full">Nouveau lien régie</button>
                  <button onClick={() => action({ action: "delete", code: s.code }, `Supprimer définitivement « ${s.name} » ?`)}
                    className="font-bold text-red-600 bg-red-50 px-3 py-1.5 rounded-full">Supprimer</button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {tab === "memory" && <SongMemory call={call} total={data?.songs} focus={focus?.on === "memory" ? focus.at : null} />}
      {tab === "queue" && <Prefill call={call} state={data?.prefill} onChanged={load} />}

      {tab === "reglages" && cfg && (
        <div className="grid gap-4 md:grid-cols-2 items-start">
          <div className="space-y-4">
            <div className="bg-white rounded-2xl border border-purple-100 p-5 space-y-4 text-sm">
              <h2 className="font-bold text-base text-gray-900">Accès et recherche</h2>
              <div>
                <p className="font-semibold mb-1.5">Moteur de recherche des invités</p>
                <div className="flex bg-gray-100 rounded-full p-0.5">
                  {[["deezer", "Deezer (sans quota)"], ["youtube", "YouTube"]].map(([id, label]) => (
                    <button key={id} onClick={() => id !== cfg.searchEngine && action({ action: "settings", searchEngine: id })}
                      className={`flex-1 px-2 py-1.5 rounded-full font-bold ${id === cfg.searchEngine ? "bg-fuchsia-600 text-white" : "text-gray-500 hover:text-gray-900"}`}>
                      {label}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-gray-400 mt-1.5">
                  {cfg.searchEngine === "deezer"
                    ? "Les invités cherchent dans le catalogue Deezer ; la vidéo YouTube n'est cherchée qu'à l'ajout (gardée 30 j, partagée entre soirées)."
                    : "Chaque recherche d'invité consomme le quota YouTube (~100 recherches nouvelles par jour)."}
                </p>
              </div>
              <label className="flex items-center justify-between gap-3">
                <span className="font-semibold">Suppression après inactivité</span>
                <select value={cfg.retentionDays} onChange={(e) => action({ action: "settings", retentionDays: Number(e.target.value) })}
                  className="border-2 border-gray-200 rounded-xl px-3 py-1.5 font-semibold">
                  {RETENTION_CHOICES.map((n) => <option key={n} value={n}>{n} jour{n > 1 ? "s" : ""}</option>)}
                </select>
              </label>
              <div>
                <p className="font-semibold mb-1.5">Qui peut créer une soirée ?</p>
                <div className="flex bg-gray-100 rounded-full p-0.5">
                  {CREATION_MODES.map((m) => (
                    <button key={m.id} onClick={() => m.id !== cfg.creationMode && action({
                      action: "settings", creationMode: m.id, ...(m.id === "code" && !cfg.creationCode ? { creationCode: randomCode() } : {}),
                    })}
                      className={`flex-1 px-2 py-1.5 rounded-full font-bold ${m.id === cfg.creationMode ? "bg-fuchsia-600 text-white" : "text-gray-500 hover:text-gray-900"}`}>
                      {m.label}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-gray-400 mt-1.5">{CREATION_MODES.find((m) => m.id === cfg.creationMode)?.hint}</p>
              </div>
              {cfg.creationMode === "code" && (
                <div className="flex items-center gap-2">
                  <span className="text-gray-600">Code de création :</span>
                  <span className="font-mono font-black text-lg tracking-widest">{cfg.creationCode}</span>
                  <button onClick={() => action({ action: "settings", creationCode: randomCode() }, "Générer un nouveau code ? L'ancien ne fonctionnera plus.")}
                    className="ml-auto text-xs text-fuchsia-600 underline">Nouveau code</button>
                </div>
              )}
              <p className="text-xs text-gray-400 pt-2 border-t border-gray-100">Quota YouTube : {QUOTA_NOTE}</p>
            </div>
            <div className="bg-white rounded-2xl border border-purple-100 p-5 text-sm">
              <h2 className="font-bold text-base text-gray-900 mb-2">Mot de passe</h2>
              <ChangePasswordForm accent="bg-fuchsia-600" note="Le même mot de passe sert au super-admin Clic-Clac."
                onSubmit={(current, next) => call("POST", { action: "password", current, next })} />
            </div>
          </div>
          <div className="bg-white rounded-2xl border border-purple-100 p-5 space-y-4 text-sm">
            <h2 className="font-bold text-base text-gray-900">Nouvelles soirées</h2>
            <div>
              <p className="font-semibold mb-1">Fonctions des soirées créées par d'autres</p>
              <p className="text-xs text-gray-400 mb-2">Modifiables ensuite pour chaque soirée, dans l'onglet Soirées.</p>
              <FeatureToggles value={cfg.defaultFeatures} onChange={(f) => action({ action: "settings", defaultFeatures: f })} />
            </div>
            <div className="pt-3 border-t border-gray-100">
              <p className="font-semibold mb-1">Réglages de départ</p>
              <p className="text-xs text-gray-400 mb-2">Pour toutes les soirées créées ensuite (par vous ou par d'autres) ; la régie peut les changer pendant la soirée.</p>
              <SoireeFields value={cfg.defaultOptions} onChange={(patch) => action({ action: "settings", defaultOptions: patch })} />
            </div>
          </div>
        </div>
      )}
    </Page>
  );
}

/* Chiffre clé en tête de page (cliquable : ouvre la page correspondante). */
function Stat({ label, value, title, onClick, active, children }) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag onClick={onClick} title={title}
      className={`text-left bg-white rounded-2xl border-2 px-4 py-3 min-w-0 ${active ? "border-fuchsia-500" : "border-purple-100"} ${onClick ? "hover:border-fuchsia-300" : ""}`}>
      <p className="text-xs text-gray-500 leading-tight">{label}</p>
      <p className="text-xl font-black text-gray-900 tabular-nums">{value}</p>
      {children}
    </Tag>
  );
}

/* Création d'une soirée déjà configurée : fonctions activées et réglages de
 * la régie (modifiables ensuite par la régie, sauf les fonctions). */
function CreateForm({ token, defaults, defaultOptions, onCreated }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [more, setMore] = useState(false);
  const [features, setFeatures] = useState(null);
  const [changed, setChanged] = useState(null); // réglages modifiés pour cette soirée
  const feats = features || defaults || {};
  const base = defaultOptions || SOIREE_DEFAULTS;
  const opts = { ...base, ...changed, blind: { ...base.blind, ...changed?.blind } };
  const change = (patch) => setChanged((c) => ({ ...c, ...patch, blind: { ...c?.blind, ...patch.blind } }));

  const create = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      const res = await fetch("/api/jukebox", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-jukebox-super": token },
        body: JSON.stringify({ name, maxPerParticipant: opts.maxPerParticipant, features: feats, options: opts }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Création impossible.");
      onCreated(d.code, d.adminToken, name.trim());
      setName("");
      setChanged(null);
    } catch (err) {
      alert(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={create} className="bg-white rounded-2xl border border-purple-100 p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <input maxLength={MAX_NAME_LEN} placeholder="Nom d'une nouvelle soirée" value={name} onChange={(e) => setName(e.target.value)}
          className="flex-1 min-w-[200px] border-2 border-gray-200 rounded-xl px-4 py-2 focus:border-fuchsia-500 outline-none" />
        <button type="button" onClick={() => setMore((v) => !v)} className="text-sm font-bold text-fuchsia-600">
          ⚙️ Configuration {more ? "▲" : "▼"}
        </button>
        <button disabled={busy || !name.trim()} className="bg-fuchsia-600 disabled:opacity-40 text-white font-bold px-5 py-2 rounded-full">
          {busy ? "Création…" : "+ Créer la soirée"}
        </button>
      </div>
      {more && (
        <div className="grid gap-5 md:grid-cols-2 text-sm pt-2 border-t border-gray-100">
          <div className="space-y-2">
            <p className="font-bold text-gray-900">Fonctions de la soirée</p>
            <p className="text-xs text-gray-400 -mt-1">La régie ne peut pas les changer.</p>
            <FeatureToggles value={feats} onChange={(f) => setFeatures(f)} />
          </div>
          <div className="space-y-2.5">
            <p className="font-bold text-gray-900">Réglages de départ de la régie</p>
            <SoireeFields value={opts} features={feats} onChange={change} />
          </div>
        </div>
      )}
    </form>
  );
}

/* Réglages d'une soirée (création, ou réglages de départ par défaut) :
 * onChange reçoit seulement ce qui change. `features` : n'affiche l'ambiance
 * et le blind test que si la fonction est activée (tous sinon). */
function SoireeFields({ value, features, onChange }) {
  const v = value || SOIREE_DEFAULTS;
  const check = "flex items-center justify-between gap-3";
  const select = "border-2 border-gray-200 rounded-xl px-2 py-1 font-semibold";
  const num = (k) => (e) => onChange({ [k]: Number(e.target.value) });
  const blind = (k, val) => onChange({ blind: { [k]: val } });
  return (
    <div className="space-y-2.5">
      <label className={check}><span>Titres en attente / invité</span>
        <select value={v.maxPerParticipant} onChange={num("maxPerParticipant")} className={select}>
          {MAX_CHOICES.map((n) => <option key={n} value={n}>{maxLabel(n)}</option>)}
        </select>
      </label>
      <label className={check}><span>Versions proposées</span>
        <select value={v.searchMode} onChange={(e) => onChange({ searchMode: e.target.value })} className={select}>
          {SEARCH_MODES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
      </label>
      <label className={check}><span>Fondu enchaîné</span>
        <select value={v.fade} onChange={num("fade")} className={select}>
          {FADE_CHOICES.map((n) => <option key={n} value={n}>{n ? `${n} s` : "Non"}</option>)}
        </select>
      </label>
      <label className={check}><span>Nom de l'invité</span>
        <select value={v.authorReveal} onChange={num("authorReveal")} className={select}>
          {AUTHOR_REVEAL_CHOICES.map((c) => <option key={c.v} value={c.v}>{c.label}</option>)}
        </select>
      </label>
      {[["dedications", "Dédicaces"], ["fairQueue", "File équitable"], ["screenQueue", "File à suivre sur l'écran"], ["guestQueue", "Invités : voir toute la file"]].map(([k, label]) => (
        <label key={k} className={check}><span>{label}</span>
          <input type="checkbox" checked={!!v[k]} onChange={(e) => onChange({ [k]: e.target.checked })} className="w-5 h-5 accent-fuchsia-600" />
        </label>
      ))}
      {(!features || features.theme) && (
        <label className={check}><span>🎨 Ambiance</span>
          <select value={v.palette} onChange={(e) => onChange({ palette: e.target.value })} className={select}>
            {THEMES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </label>
      )}
      {(!features || features.blindtest) && (
        <>
          <label className={check}><span>🕵️ Blind test</span>
            <select value={v.blind.mode} onChange={(e) => blind("mode", e.target.value)} className={select}>
              {BLIND_MODES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </label>
          <label className={check}><span className="pl-6">Dévoiler la réponse</span>
            <select value={v.blind.reveal} onChange={(e) => blind("reveal", Number(e.target.value))} className={select}>
              {BLIND_REVEAL_CHOICES.map((c) => <option key={c.v} value={c.v}>{c.label}</option>)}
            </select>
          </label>
          <label className={check}><span className="pl-6">Titre suivant</span>
            <select value={v.blind.after} onChange={(e) => blind("after", Number(e.target.value))} className={select}>
              {BLIND_AFTER_CHOICES.map((c) => <option key={c.v} value={c.v}>{c.label}</option>)}
            </select>
          </label>
          <label className={check}><span className="pl-6">Titres piochés automatiquement</span>
            <input type="checkbox" checked={!!v.blind.auto} onChange={(e) => blind("auto", e.target.checked)} className="w-5 h-5 accent-fuchsia-600" />
          </label>
        </>
      )}
    </div>
  );
}

/* Interrupteurs des fonctions (historique, thème, blind test). */
function FeatureToggles({ value, onChange }) {
  return (
    <div className="space-y-2">
      {FEATURES.map((f) => (
        <label key={f.id} className="flex items-start gap-2.5 cursor-pointer">
          <input type="checkbox" checked={!!value?.[f.id]} onChange={(e) => onChange({ ...value, [f.id]: e.target.checked })}
            className="w-5 h-5 mt-0.5 accent-fuchsia-600 shrink-0" />
          <span><span className="font-semibold">{f.icon} {f.label}</span><span className="block text-xs text-gray-400">{f.hint}</span></span>
        </label>
      ))}
    </div>
  );
}

/* Lien régie à transmettre : copie, partage (téléphone) ou e-mail. */
function LinkBox({ name, url, joinUrl, onClose }) {
  const [copied, setCopied] = useState(false);
  const message = `Voici le lien de la régie de votre soirée « ${name} » (à ouvrir sur le PC branché à la sono) :\n${url}\n\nNe le partagez pas avec les invités : ils proposent leurs titres ici : ${joinUrl}`;
  const share = async () => {
    try { await navigator.share({ title: `Régie « ${name} »`, text: message }); } catch (e) { /* annulé */ }
  };
  return (
    <div className="mt-4 bg-fuchsia-50 border border-fuchsia-200 rounded-2xl p-4">
      <p className="font-bold text-gray-900 mb-1">Lien régie de « {name} » — à transmettre à l'organisateur</p>
      <p className="text-xs text-gray-500 mb-2">Ce lien donne le contrôle de la soirée : ne le partagez pas avec les invités.</p>
      <div className="flex flex-wrap gap-2 items-center">
        <code className="flex-1 min-w-0 break-all bg-white rounded-lg px-3 py-2 text-xs">{url}</code>
        <button onClick={async () => { try { await navigator.clipboard.writeText(url); setCopied(true); } catch (e) { /* ignoré */ } }}
          className="bg-gray-900 text-white text-sm font-bold px-4 py-2 rounded-full">{copied ? "✓ Copié" : "Copier"}</button>
        {typeof navigator !== "undefined" && navigator.share && (
          <button onClick={share} className="bg-fuchsia-600 text-white text-sm font-bold px-4 py-2 rounded-full">Partager…</button>
        )}
        <a href={`mailto:?subject=${encodeURIComponent(`Régie de la soirée « ${name} »`)}&body=${encodeURIComponent(message)}`}
          className="bg-white border border-gray-200 text-sm font-bold px-4 py-2 rounded-full">✉️ E-mail</a>
        <button onClick={onClose} className="text-sm text-gray-400 underline">Fermer</button>
      </div>
    </div>
  );
}

function Page({ children }) {
  return (
    <div className="min-h-screen bg-purple-50 px-4 py-6">
      <div className="max-w-5xl mx-auto">
        <Link href="/jukebox" className="inline-flex items-center gap-2 text-sm font-bold text-gray-500 mb-4">← Jukebox</Link>
        {children}
      </div>
    </div>
  );
}

/* Mémoire « titre Deezer → vidéo YouTube », à passer en revue : filtres
 * (à vérifier / validés, mode), aperçu de la vidéo retenue, validation,
 * changement de vidéo (repasse « à vérifier »), oubli (le titre sera recherché à
 * nouveau au prochain ajout). */
const STATUS_FILTERS = [["todo", "À vérifier"], ["missing", "⚠️ À remplacer"], ["ok", "Validés"], ["blind", "🕵️ Blind test"], ["all", "Tous"]];
const MODE_TAG = {
  normal: "bg-sky-100 text-sky-700",
  paroles: "bg-amber-100 text-amber-700",
  karaoke: "bg-fuchsia-100 text-fuchsia-700",
};

function SongMemory({ call, total, focus }) {
  const [open, setOpen] = useState(true);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("todo");
  // tuile « Titres en mémoire » : liste complète, sans filtre
  useEffect(() => {
    if (!focus) return;
    setOpen(true);
    setStatus("all");
    setQ("");
  }, [focus]);
  const [mode, setMode] = useState("");
  const [songs, setSongs] = useState(null);
  const [err, setErr] = useState("");
  const [fixing, setFixing] = useState(null); // titre dont on change la vidéo
  const [preview, setPreview] = useState(null); // clé du titre en aperçu

  const load = useCallback(async () => {
    try {
      const qs = new URLSearchParams({ songs: "1", q, status, mode });
      const res = await fetch(`/api/jukebox/super?${qs}`, {
        cache: "no-store", headers: { "x-jukebox-super": getSuperToken() || "" },
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Chargement impossible.");
      setSongs(d.songs);
      setErr("");
    } catch (e) {
      setErr(e.message);
    }
  }, [q, status, mode]);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [open, load]);

  const run = async (body, confirmText) => {
    if (confirmText && !confirm(confirmText)) return;
    try { await call("POST", body); load(); } catch (e) { alert(e.message); }
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
            <b> Oublier</b> la fera rechercher à nouveau au prochain ajout.
          </p>
          <div className="flex flex-wrap gap-2 items-center">
            <div className="flex bg-gray-100 rounded-full p-0.5 text-sm">
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
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher un artiste, un titre…"
              className="flex-1 min-w-[180px] border-2 border-gray-200 rounded-full px-4 py-1.5 text-sm focus:border-fuchsia-500 outline-none" />
          </div>
          {err && <p className="text-sm text-red-600">{err}</p>}
          {fixing && <SongVideoChooser song={fixing} call={call} onClose={() => setFixing(null)}
            onDone={() => { setStatus((st) => (st === "ok" ? "all" : st)); setPreview(fixing.key); load(); }} />}
          {songs === null ? <p className="text-sm text-gray-400">Chargement…</p> : songs.length === 0 ? (
            <p className="text-sm text-gray-400">{status === "todo" ? "Rien à vérifier 🎉" : status === "missing" ? "Aucune vidéo disparue 👍" : status === "blind" ? "Aucun titre marqué « Blind test » : utilisez l'étiquette 🕵️ sur les titres (filtre Tous)." : "Aucun titre."}</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {songs.map((s) => (
                <li key={s.key} className="flex flex-wrap items-center gap-3 py-2.5">
                  <PreviewThumb videoId={s.videoId} active={preview === s.key} onClick={() => setPreview(preview === s.key ? null : s.key)} />
                  <div className="flex-1 min-w-[160px]">
                    <p className="text-sm font-semibold text-gray-900 truncate">{s.label || <span className="text-gray-400 font-mono text-xs">{s.key}</span>}</p>
                    <div className="flex flex-wrap items-center gap-1.5 mt-1">
                      <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${MODE_TAG[s.mode] || "bg-gray-100 text-gray-600"}`}>{modeLabel(s.mode)}</span>
                      {s.missing
                        ? <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-700" title="La vidéo n'existe plus ou n'est plus lisible : choisissez-en une autre">⚠️ Vidéo disparue · à remplacer</span>
                        : s.validated
                        ? <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-green-100 text-green-700">✓ Validé</span>
                        : <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">À vérifier</span>}
                      <button onClick={() => run({ action: "blindSong", key: s.key, blind: !s.blind })}
                        title={s.blind ? "Retirer du blind test automatique" : "Utiliser dans le blind test automatique"}
                        className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${s.blind ? "bg-violet-600 text-white" : "bg-gray-100 text-gray-400 hover:text-gray-700"}`}>
                        🕵️ Blind test{s.blind ? "" : " ?"}
                      </button>
                      <span className="text-xs text-gray-400">{formatDuration(s.duration)} · vérifié le {new Date(s.checkedAt).toLocaleDateString("fr-FR")}</span>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5 shrink-0">
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
                    <a href={`https://www.youtube.com/watch?v=${s.videoId}`} target="_blank" rel="noreferrer"
                      className="text-xs font-bold text-gray-500 bg-gray-100 px-3 py-1.5 rounded-full">YouTube ↗</a>
                    <button onClick={() => run({ action: "forgetSong", key: s.key }, `Oublier « ${s.label || s.key} » (${modeLabel(s.mode)}) ?\nLe titre sera recherché à nouveau au prochain ajout.`)}
                      className="text-xs font-bold text-red-600 bg-red-50 px-3 py-1.5 rounded-full">Oublier</button>
                  </div>
                  {preview === s.key && (
                    <div className="w-full max-w-xl"><VideoPreview videoId={s.videoId} onClose={() => setPreview(null)} /></div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

const STOP_TEXT = { quota: "quota épuisé", time: "temps écoulé", empty: "file terminée" };

/* Pré-remplissage : titres mis en attente, cherchés chaque matin vers 6 h
 * avec le reste du quota YouTube de la veille. */
function Prefill({ call, state, onChanged }) {
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
            <span>Marquer ces titres <b>🕵️ Blind test</b> (pioche automatique ; mode Normale conseillé, les paroles trahiraient le titre)</span>
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

  const edit = async (keys, op) => {
    try { await call("POST", { action: "prefillEdit", keys, op }); setSel(new Set()); await load(); onChanged(); } catch (e) { alert(e.message); }
  };
  const clear = async () => {
    if (!confirm(`Vider la file (${items.length} titres en attente) ?`)) return;
    try { await call("POST", { action: "clearPrefill" }); setSel(new Set()); await load(); onChanged(); } catch (e) { alert(e.message); }
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
            <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full shrink-0 ${MODE_TAG[it.mode] || "bg-gray-100 text-gray-600"}`}>{modeLabel(it.mode)}</span>
            {it.blind && <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-violet-600 text-white shrink-0">🕵️</span>}
            <button onClick={() => edit([it.key], "top")} title="Traiter en premier" className="text-gray-400 hover:text-gray-900 px-1 shrink-0">⤒</button>
            <button onClick={() => edit([it.key], "remove")} title="Retirer" className="text-gray-400 hover:text-red-600 px-1 shrink-0">✕</button>
          </li>
        ))}
        {shown.length > 300 && <li className="py-2 text-xs text-gray-400">… et {shown.length - 300} autres (filtrez pour les voir)</li>}
      </ul>
    </div>
  );
}

function SongVideoChooser({ song, call, onClose, onDone }) {
  return (
    <VideoChooser title={song.label || song.key} subtitle={`Mode ${modeLabel(song.mode)}`} initial={song.videoId}
      onClose={onClose} onDone={onDone}
      load={() => call("POST", { action: "songVideos", key: song.key })}
      choose={(videoId) => call("POST", { action: "replaceSong", key: song.key, videoId })} />
  );
}

const modeLabel = (m) => SEARCH_MODES.find((x) => x.id === m)?.label || m;
