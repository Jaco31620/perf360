"use client";
/*
 * Jukebox — super-admin (/jukebox/admin), mot de passe de Clic-Clac :
 * toutes les soirées (activité, suppression prévue), accès à leur régie,
 * nouveau lien régie, suppression ; codes d'activation individuels des
 * organisateurs (onglet Codes) ; réglages de conservation et de création ;
 * recherches YouTube du jour ; mémoire des titres (recherche, oubli) et
 * son pré-remplissage (titres cherchés par le cron de 6 h).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import PasswordInput from "@/components/PasswordInput";
import ChangePasswordForm from "@/components/ChangePasswordForm";
import { getSuperToken, setSuperToken, setAdminToken, rememberParty } from "../storage";
import { CREATION_MODES } from "./shared";
import { RETENTION_CHOICES, retentionLabel } from "@/lib/jukebox";
import { CreateForm, SoireeFields, FeatureToggles, InviteBox } from "./SoireeForms";
import { Activations } from "./Activations";
import { Soirees } from "./Soirees";
import { Requests } from "./Requests";
import { Prefill } from "./Prefill";
import { SongMemory } from "./SongMemory";

const SEARCH_QUOTA = 100; // ~10 000 unités / jour, 100 par recherche
const QUOTA_NOTE = "Remise à zéro chaque jour à minuit heure du Pacifique (8 h ou 9 h à Paris selon la saison). Les recherches déjà faites et les liens collés ne comptent pas. Avec Deezer, seul l'ajout d'un titre jamais choisi compte.";

export default function SuperAdmin() {
  const [token, setToken] = useState(undefined);
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [data, setData] = useState(null);
  const [origin, setOrigin] = useState("");
  const [link, setLink] = useState(null); // { name, code, regieCode } invitation à transmettre à l'organisateur
  const [filter, setFilter] = useState("");
  const [actFilter, setActFilter] = useState(""); // recherche de l'onglet Codes
  const [focus, setFocus] = useState(null); // { on: "memory" | "queue", at } : tuile cliquée
  const goTo = (on) => { chooseTab(on); setFocus({ on, at: Date.now() }); };
  const [tab, setTab] = useState("soirees"); // onglet retenu par appareil
  const [demande, setDemande] = useState(null); // demande ouverte depuis l'e-mail
  useEffect(() => { try { const t = localStorage.getItem("jukebox:superTab"); if (["soirees", "demandes", "codes", "reglages", "memory", "queue"].includes(t)) setTab(t); } catch (e) { /* ignoré */ }
    // lien de l'e-mail de demande : /jukebox/admin?demande=<id>
    const d = new URLSearchParams(window.location.search).get("demande");
    if (d) { setTab("demandes"); setDemande(d); }
  }, []);
  const chooseTab = (t) => { setTab(t); try { localStorage.setItem("jukebox:superTab", t); } catch (e) { /* ignoré */ } };


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

  // Réglages affichés dès le clic ; actions envoyées une par une, dans l'ordre.
  const queue = useRef(Promise.resolve());
  const action = async (body, confirmText) => {
    if (confirmText && !confirm(confirmText)) return null;
    setData((d) => applyLocally(d, body));
    const run = queue.current.then(() => call("POST", body));
    queue.current = run.catch(() => {});
    try { const d = await run; await load(); return d; } catch (e) { alert(e.message); load(); return null; }
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
  const nPending = data?.requests?.filter((r) => r.status === "pending").length ?? 0;
  const tabs = [
    { id: "soirees", label: `🎉 Soirées${nSessions ? ` (${nSessions})` : ""}` },
    { id: "demandes", label: `📥 Demandes${nPending ? ` (${nPending})` : ""}`, alert: nPending > 0 },
    { id: "codes", label: `🎟️ Codes${data?.activations?.length ? ` (${data.activations.length})` : ""}` },
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

      <div className="flex overflow-x-auto bg-white border border-purple-100 rounded-full p-1 mb-4 w-full sm:w-fit">
        {tabs.map((t) => (
          <button key={t.id} onClick={() => chooseTab(t.id)}
            className={`flex-1 sm:flex-none px-4 py-2 rounded-full font-bold text-sm whitespace-nowrap ${tab === t.id ? "bg-fuchsia-600 text-white" : t.alert ? "text-fuchsia-700 bg-fuchsia-50" : "text-gray-500 hover:text-gray-900"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "soirees" && (
        <>
          <CreateForm token={token} defaults={cfg?.defaultFeatures} defaultOptions={cfg?.defaultOptions} onCreated={(code, adminToken, name, regieCode) => {
            setAdminToken(code, adminToken);
            rememberParty(code, name);
            setLink({ name, code, regieCode });
            load();
          }} />
          {link && <InviteBox {...link} origin={origin} onClose={() => setLink(null)} />}
          {data && <Soirees sessions={data.sessions} staleDays={cfg?.retentionDays || 7} origin={origin} action={action} filter={filter} setFilter={setFilter}
            onShowCode={(who) => { setActFilter(who); chooseTab("codes"); window.scrollTo({ top: 0 }); }} />}
        </>
      )}

      {tab === "demandes" && data && (
        <Requests list={data.requests} activations={data.activations} defaults={cfg?.defaultFeatures} origin={origin} action={action} highlight={demande}
          onShowCode={(c) => { setActFilter(c); chooseTab("codes"); window.scrollTo({ top: 0 }); }} />
      )}

      {tab === "codes" && data && (
        <Activations list={data.activations} filter={actFilter} setFilter={setActFilter}
          onOpenParty={(code) => { setFilter(code); chooseTab("soirees"); window.scrollTo({ top: 0 }); }} sessions={data.sessions} defaults={cfg?.defaultFeatures} origin={origin}
          creationMode={cfg?.creationMode} action={action} onUseCodes={() => action({ action: "settings", creationMode: "code" })} />
      )}

      {tab === "memory" && <SongMemory call={call} total={data?.songs} proposals={data?.proposals || 0} focus={focus?.on === "memory" ? focus.at : null} enrich={data?.enrich} onChanged={load} />}
      {tab === "queue" && <Prefill call={call} state={data?.prefill} onChanged={load} />}

      {tab === "reglages" && cfg && (
        <div className="grid gap-4 md:grid-cols-2 items-start">
          <div className="space-y-4">
            <div className="bg-white rounded-2xl border border-purple-100 p-5 space-y-4 text-sm">
              <h2 className="font-bold text-base text-gray-900">Accès</h2>
              <label className="flex items-center justify-between gap-3">
                <span className="font-semibold">Proposer la suppression après<span className="block text-xs font-normal text-gray-400">jours sans activité (aucune suppression automatique : onglet Soirées, filtre 💤).</span></span>
                <select value={cfg.retentionDays} onChange={(e) => action({ action: "settings", retentionDays: Number(e.target.value) })}
                  className="border-2 border-gray-200 rounded-xl px-3 py-1.5 font-semibold">
                  {RETENTION_CHOICES.map((n) => <option key={n} value={n}>{retentionLabel(n)}</option>)}
                </select>
              </label>
              <div>
                <p className="font-semibold mb-1.5">Qui peut créer une soirée ?</p>
                <div className="flex bg-gray-100 rounded-full p-0.5">
                  {CREATION_MODES.map((m) => (
                    <button key={m.id} onClick={() => m.id !== cfg.creationMode && action({ action: "settings", creationMode: m.id })}
                      className={`flex-1 px-2 py-1.5 rounded-full font-bold ${m.id === cfg.creationMode ? "bg-fuchsia-600 text-white" : "text-gray-500 hover:text-gray-900"}`}>
                      {m.label}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-gray-400 mt-1.5">{CREATION_MODES.find((m) => m.id === cfg.creationMode)?.hint}</p>
              </div>
              {cfg.creationMode === "code" && (
                <button onClick={() => chooseTab("codes")} className="text-xs text-fuchsia-600 underline">🎟️ Gérer les codes d'activation</button>
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

/* Effet immédiat d'une action du super-admin sur l'état affiché. */
function applyLocally(d, body) {
  if (!d) return d;
  if (body.action === "delete") return { ...d, sessions: d.sessions.filter((s) => s.code !== body.code) };
  if (body.action === "features")
    return { ...d, sessions: d.sessions.map((s) => (s.code === body.code ? { ...s, features: { ...s.features, ...body.features } } : s)) };
  if (body.action === "actUpdate" && d.activations) {
    const { action, id, resetUsed, ...patch } = body;
    return { ...d, activations: d.activations.map((a) => (a.id === id ? { ...a, ...patch, ...(resetUsed ? { used: 0 } : {}) } : a)) };
  }
  if (body.action === "actDelete" && d.activations) return { ...d, activations: d.activations.filter((a) => a.id !== body.id) };
  if (body.action !== "settings") return d;
  const { action, defaultFeatures, defaultOptions, ...rest } = body;
  const c = d.config;
  return {
    ...d,
    config: {
      ...c, ...rest,
      ...(defaultFeatures ? { defaultFeatures: { ...c.defaultFeatures, ...defaultFeatures } } : {}),
      ...(defaultOptions ? { defaultOptions: { ...c.defaultOptions, ...defaultOptions, blind: { ...c.defaultOptions.blind, ...defaultOptions.blind } } } : {}),
    },
  };
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
