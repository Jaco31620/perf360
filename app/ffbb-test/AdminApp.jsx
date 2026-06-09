"use client";
/*
 * Espace administrateur d'une instance (campagne). Reçoit `campaign`
 * = { id, slug, name, config } (config PUBLIQUE, sans mot de passe). L'auth se
 * fait CÔTÉ SERVEUR (/api/ffbb/auth) ; un jeton de campagne signé est ensuite
 * joint à chaque opération (/api/ffbb/admin). Le client ne touche plus la base
 * en direct — sauf le Storage (logos, bucket public ffbb-assets).
 *
 * Dispositif autonome : navigation interne uniquement, AUCUN lien vers l'accueil perf360.
 */
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Lock, Plus, Download, Mail, Settings, Tag, Users, Trash2, ArrowLeft, Image as ImageIcon, LogOut, Eye, QrCode, AlertTriangle, Search } from "lucide-react";
import { QRCodeCanvas } from "qrcode.react";
import { supabase } from "@/lib/supabase";
import {
  C, fillTemplate, maskDescription,
  authCampaign, adminCall, getCampaignToken, setCampaignToken, getMasterToken,
  Card, DarkCard, Stat, Check, PageShell, Loader,
  btnPrimary, btnGhost, btnGhostLight, h3, pSub, lbl, td, darkInput,
} from "./shared";
import RichEditor from "./RichEditor";
import { buildEmailHtml } from "./emailTemplate";

export default function AdminApp({ campaign }) {
  const cid = campaign.id;
  const slug = campaign.slug;
  const [config, setConfig] = useState(campaign.config);
  // Compteurs (agrégats DB) au lieu de charger tous les codes/inscriptions → tient les gros volumes.
  const [counts, setCounts] = useState({ total: 0, available: 0, assigned: 0, regs: 0, newsletter: 0 });
  const [loading, setLoading] = useState(true);
  const [authed, setAuthed] = useState(false);
  const [campaignName, setCampaignName] = useState(campaign.name);
  const router = useRouter();
  const tokenRef = useRef(null);       // jeton de campagne courant
  const saveTimer = useRef(null);
  const nameTimer = useRef(null);

  /* Recharge les compteurs (codes total/dispo, inscrits, opt-in). */
  async function refreshCounts() {
    const { counts: c } = await adminCall("stats", cid, {}, tokenRef.current);
    setCounts(c);
  }

  /* Une page d'inscriptions (récentes d'abord) — pour la pagination de l'onglet Attributions. */
  async function fetchRegistrationsPage(from, size) {
    try {
      const { rows } = await adminCall("regsPage", cid, { from, size }, tokenRef.current);
      return rows || [];
    } catch (e) { console.error(e); return []; }
  }

  /* Recherche d'inscriptions (par code, e-mail ou nom). */
  async function searchRegistrations(q) {
    try {
      const { rows } = await adminCall("search", cid, { q }, tokenRef.current);
      return rows || [];
    } catch (e) { console.error(e); return []; }
  }

  /* Toutes les inscriptions (paginé côté serveur) — pour l'export CSV complet. */
  async function fetchAllRegistrations() {
    try {
      const { rows } = await adminCall("exportAll", cid, {}, tokenRef.current);
      return rows || [];
    } catch (e) { console.error(e); return []; }
  }

  /* Ajout par lots (dédup + upsert côté serveur). Renvoie { added, total }. */
  async function addCodes(list) {
    try {
      const r = await adminCall("addCodes", cid, { codes: list }, tokenRef.current);
      await refreshCounts();
      return r;
    } catch (e) { console.error(e); await refreshCounts().catch(() => {}); return { added: 0, total: list.length, error: true }; }
  }

  async function resetAll() {
    try {
      await adminCall("reset", cid, {}, tokenRef.current);
      await refreshCounts();
    } catch (e) { console.error(e); }
  }

  /* Une autre instance utilise-t-elle cette image d'en-tête ? (avant suppression Storage) */
  async function headerUsedElsewhere(url) {
    try {
      const { used } = await adminCall("headerUsedElsewhere", cid, { url }, tokenRef.current);
      return used;
    } catch (e) { console.error(e); return true; } // en cas de doute, on ne supprime pas
  }

  /* Renommage de l'instance (débouncé). */
  function renameInstance(n) {
    setCampaignName(n);
    if (nameTimer.current) clearTimeout(nameTimer.current);
    nameTimer.current = setTimeout(() => {
      adminCall("rename", cid, { name: n }, tokenRef.current).catch(e => console.error(e));
    }, 500);
  }

  /* Sauvegarde débouncée de la config. */
  function persistConfig(cfg) {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      adminCall("saveConfig", cid, { config: cfg }, tokenRef.current).catch(e => console.error(e));
    }, 500);
  }

  function mutateCfg(fn) {
    setConfig(prev => {
      const next = structuredClone(prev);
      fn(next);
      persistConfig(next);
      return next;
    });
  }

  /* Connexion réussie (mot de passe vérifié côté serveur) → jeton + config complète. */
  async function applyAuth(result) {
    tokenRef.current = result.token;
    if (result.campaign) {
      setConfig(result.campaign.config);
      if (result.campaign.name != null) setCampaignName(result.campaign.name);
    }
    setAuthed(true);
    try { await refreshCounts(); } catch (e) { console.error(e); }
  }

  useEffect(() => {
    let alive = true;
    (async () => {
      const ct = getCampaignToken(slug);
      const mt = getMasterToken();
      try {
        if (ct) {
          // Jeton de campagne stocké → on le revalide et on charge la config complète.
          const r = await adminCall("getConfig", cid, {}, ct);
          if (!alive) return;
          tokenRef.current = ct;
          setConfig(r.config);
          if (r.name != null) setCampaignName(r.name);
          setAuthed(true);
          await refreshCounts();
        } else if (mt) {
          // Session super-admin ouverte → entrée directe sans re-saisie.
          const r = await authCampaign(slug, { token: mt });
          if (!alive) return;
          await applyAuth(r);
        }
      } catch (e) {
        // Jeton invalide/expiré → on nettoie et on affiche le login.
        setCampaignToken(slug, null);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      if (nameTimer.current) clearTimeout(nameTimer.current);
    };
  }, [cid]);

  if (loading) return <Loader />;

  return (
    <PageShell>
      {authed ? (
        <Admin
          config={config} counts={counts} slug={slug} campaignName={campaignName} renameInstance={renameInstance}
          mutateCfg={mutateCfg} addCodes={addCodes} resetAll={resetAll} headerUsedElsewhere={headerUsedElsewhere}
          searchRegistrations={searchRegistrations} fetchAllRegistrations={fetchAllRegistrations} fetchRegistrationsPage={fetchRegistrationsPage}
          onExit={() => router.push(`/${slug}`)}
          onLogout={() => { setCampaignToken(slug, null); tokenRef.current = null; setAuthed(false); }}
        />
      ) : (
        <AdminLogin
          slug={slug} campaignName={campaignName}
          onAuthed={applyAuth}
          onBack={() => router.push(`/${slug}`)}
        />
      )}
    </PageShell>
  );
}

/* ----------------------------- ADMIN LOGIN ----------------------------- */
function AdminLogin({ slug, campaignName, onAuthed, onBack }) {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  async function tryLogin() {
    if (busy) return;
    setBusy(true); setErr("");
    try {
      const r = await authCampaign(slug, { password: pw });
      await onAuthed(r);
    } catch (e) {
      setErr(e.status === 401 ? "Mot de passe incorrect." : "Connexion impossible. Réessayez.");
      setBusy(false);
    }
  }
  return (
    <div style={{ display: "flex", justifyContent: "center", padding: "60px 16px" }}>
      <div style={{ width: "100%", maxWidth: 380 }}>
        <Card>
          <div style={{ width: 46, height: 46, borderRadius: 12, background: C.ink, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 16 }}>
            <Lock size={22} color={C.green} />
          </div>
          <h2 style={{ fontSize: 22, fontWeight: 800, color: C.ink, margin: "0 0 4px", letterSpacing: "-0.4px" }}>Espace administrateur</h2>
          {campaignName && <p style={{ color: "#888", fontSize: 13.5, margin: "0 0 16px" }}>{campaignName}</p>}
          <input type="password" value={pw} placeholder="Mot de passe" onChange={e => { setPw(e.target.value); setErr(""); }}
            onKeyDown={e => { if (e.key === "Enter") tryLogin(); }}
            style={{ width: "100%", padding: "13px 15px", borderRadius: 12, border: `1.5px solid ${err ? "#b3261e" : C.cardLine}`, fontSize: 15, boxSizing: "border-box", color: C.ink, background: "#fff", outline: "none" }} />
          {err && <div style={{ color: "#b3261e", fontSize: 13, marginTop: 8 }}>{err}</div>}
          <button onClick={tryLogin} disabled={busy} style={{ ...btnPrimary, opacity: busy ? 0.6 : 1 }}>{busy ? "Connexion…" : "Se connecter"}</button>
          <button onClick={onBack} style={{ ...btnGhost, marginTop: 8 }}><ArrowLeft size={15} /> Retour au formulaire</button>
        </Card>
      </div>
    </div>
  );
}

/* ----------------------------- ADMIN ----------------------------- */
function Admin({ config, counts, slug, campaignName, renameInstance, mutateCfg, addCodes, resetAll, headerUsedElsewhere, searchRegistrations, fetchAllRegistrations, fetchRegistrationsPage, onExit, onLogout }) {
  const [tab, setTab] = useState("codes");
  const { total, available, assigned, regs: regsCount, newsletter: newsletterCount } = counts;

  // Alerte de distribution selon le mode.
  let warning = null;
  if ((config.codeMode || "unique") === "generic") {
    if (!(config.genericCode || "").trim()) {
      warning = { danger: true, text: "Aucun code générique défini : les inscriptions échoueront tant que le code n'est pas renseigné." };
    }
  } else {
    if (available === 0) {
      warning = { danger: true, text: "Aucun code disponible à distribuer : les inscriptions échoueront tant que le pool est vide." };
    } else if (total > 0 && available < total * 0.1) {
      warning = { danger: false, text: `Plus que ${available} code${available > 1 ? "s" : ""} disponible${available > 1 ? "s" : ""} sur ${total} (moins de 10 %). Pensez à réapprovisionner le pool.` };
    }
  }

  // Onglets de gestion du fonctionnement (la licence est intégrée dans Réglages).
  const tabs = [
    { id: "codes", label: "Codes", icon: Tag },
    { id: "regs", label: "Attributions", icon: Users },
    { id: "email", label: "E-mail", icon: Mail },
    { id: "settings", label: "Réglages", icon: Settings },
  ];
  const tabBtn = (on) => ({ display: "flex", alignItems: "center", gap: 7, padding: "9px 15px", borderRadius: 999, border: "none", cursor: "pointer", fontSize: 14, fontWeight: 600, background: on ? C.green : C.ink, color: on ? C.black : C.cream });

  return (
    <div style={{ maxWidth: 1000, margin: "0 auto", padding: "28px 16px 60px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 22, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 800, margin: 0, letterSpacing: "-0.6px" }}>Tableau de bord</h1>
          {campaignName && <div style={{ color: C.gray, fontSize: 13.5, marginTop: 2 }}>{campaignName} · /{slug}</div>}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button onClick={onExit} style={{ ...btnGhostLight }}><Eye size={15} /> Voir le formulaire</button>
          <button onClick={onLogout} style={{ ...btnGhostLight }}><LogOut size={15} /> Se déconnecter</button>
        </div>
      </div>

      {warning && (
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", padding: "12px 16px", borderRadius: 12, marginBottom: 18,
          background: warning.danger ? "rgba(255,122,107,0.12)" : "rgba(240,180,41,0.12)",
          border: `1px solid ${warning.danger ? "#ff7a6b" : "#f0b429"}` }}>
          <AlertTriangle size={18} color={warning.danger ? "#ff7a6b" : "#f0b429"} style={{ flexShrink: 0 }} />
          <span style={{ flex: "1 1 220px", color: C.cream, fontSize: 14, lineHeight: 1.45 }}>{warning.text}</span>
          <button onClick={() => setTab("codes")} style={{ ...btnGhostLight }}><Tag size={14} /> Aller aux codes</button>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 12, marginBottom: 24 }}>
        {(config.codeMode || "unique") === "unique" ? (
          <>
            <Stat label="Codes disponibles" value={available} accent />
            <Stat label="Codes attribués" value={assigned} />
          </>
        ) : (
          <>
            <Stat label="Distribution" value="Générique" accent />
            <Stat label="Inscrits" value={regsCount} />
          </>
        )}
        <Stat label="Opt-in newsletter" value={newsletterCount} />
      </div>

      <div style={{ display: "flex", gap: 6, marginBottom: 20, flexWrap: "wrap", alignItems: "center" }}>
        {tabs.map(t => {
          const I = t.icon, on = tab === t.id;
          return (
            <button key={t.id} onClick={() => setTab(t.id)} style={tabBtn(on)}>
              <I size={15} /> {t.label}
            </button>
          );
        })}
        {/* Promouvoir : séparé à droite (diffusion, pas gestion). */}
        <button onClick={() => setTab("promote")} style={{ ...tabBtn(tab === "promote"), marginLeft: "auto" }}>
          <QrCode size={15} /> Promouvoir
        </button>
      </div>

      {tab === "codes" && <CodesTab config={config} addCodes={addCodes} mutateCfg={mutateCfg} hasRegs={regsCount > 0} />}
      {tab === "regs" && <RegsTab total={regsCount} searchRegistrations={searchRegistrations} fetchAllRegistrations={fetchAllRegistrations} fetchRegistrationsPage={fetchRegistrationsPage} />}
      {tab === "promote" && <PromoteTab slug={slug} />}
      {tab === "email" && <EmailTab config={config} mutateCfg={mutateCfg} />}
      {tab === "settings" && <SettingsTab config={config} mutateCfg={mutateCfg} resetAll={resetAll} slug={slug} campaignName={campaignName} renameInstance={renameInstance} headerUsedElsewhere={headerUsedElsewhere} />}
    </div>
  );
}

function CodesTab({ config, addCodes, mutateCfg, hasRegs }) {
  const [bulk, setBulk] = useState("");
  const [msg, setMsg] = useState("");
  const [adding, setAdding] = useState(false);
  const [pendingMode, setPendingMode] = useState(null);
  const mode = config.codeMode || "unique";

  /* Changement de mode : confirmation requise s'il y a déjà des inscrits. */
  function requestMode(newMode) {
    if (newMode === mode) return;
    if (hasRegs) setPendingMode(newMode);
    else mutateCfg(c => { c.codeMode = newMode; });
  }
  function confirmMode() {
    const m = pendingMode;
    setPendingMode(null);
    mutateCfg(c => { c.codeMode = m; });
  }

  async function handleAdd() {
    const list = bulk.split(/[\n,;]+/).map(s => s.trim()).filter(Boolean);
    if (!list.length || adding) return;
    setAdding(true); setMsg("");
    const { added, total, error } = await addCodes(list);
    setAdding(false);
    if (error) { setMsg("Erreur lors de l'ajout. Réessayez."); return; }
    setMsg(`${added} code(s) ajouté(s)${added !== total ? ` — ${total - added} doublon(s) ignoré(s)` : ""}.`);
    setBulk("");
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <DarkCard>
        <h3 style={h3}>Type de distribution</h3>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
          {[["unique", "Codes uniques (liste)"], ["generic", "Code générique (un seul)"]].map(([id, lab]) => (
            <button key={id} onClick={() => requestMode(id)}
              style={{ padding: "9px 15px", borderRadius: 999, cursor: "pointer", fontSize: 13.5, fontWeight: 600, background: mode === id ? C.green : C.black, color: mode === id ? C.black : C.cream, borderWidth: 1, borderStyle: "solid", borderColor: mode === id ? C.green : C.line }}>{lab}</button>
          ))}
        </div>
        <p style={{ ...pSub, marginTop: 12, marginBottom: 0 }}>
          {mode === "generic"
            ? "Le même code est distribué à tous les inscrits — aucune liste nécessaire."
            : "Chaque inscrit reçoit un code différent, tiré du pool. Ajoutez vos codes ci-dessous (le suivi du stock est dans les compteurs en haut). Pool vide ⇒ le formulaire indique qu'aucun code n'est disponible."}
        </p>

        {pendingMode && (
          <div style={{ marginTop: 14, padding: "12px 14px", borderRadius: 12, background: "rgba(240,180,41,0.12)", border: "1px solid #f0b429" }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 10 }}>
              <AlertTriangle size={18} color="#f0b429" style={{ flexShrink: 0, marginTop: 2 }} />
              <span style={{ color: C.cream, fontSize: 14, lineHeight: 1.5 }}>
                Des inscrits existent déjà. En passant en <b>{pendingMode === "generic" ? "code générique" : "codes uniques"}</b>, les inscrits actuels <b>conservent leur code</b> ; seuls les nouveaux utiliseront le nouveau mode. Continuer&nbsp;?
              </span>
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button onClick={confirmMode} style={{ ...btnPrimary, width: "auto", margin: 0, background: "#f0b429" }}>Confirmer le changement</button>
              <button onClick={() => setPendingMode(null)} style={{ ...btnGhostLight, margin: 0 }}>Annuler</button>
            </div>
          </div>
        )}
      </DarkCard>

      {mode === "generic" ? (
        <DarkCard>
          <h3 style={h3}>Code générique</h3>
          <p style={pSub}>Ce code unique sera envoyé à chaque inscrit.</p>
          <label style={lbl}>Code à distribuer</label>
          <input value={config.genericCode || ""} onChange={e => mutateCfg(c => { c.genericCode = e.target.value; })}
            placeholder="EX : PARTENAIRE15" style={{ ...darkInput, maxWidth: 320, fontFamily: "monospace" }} />
        </DarkCard>
      ) : (
        <DarkCard>
          <h3 style={h3}>Ajouter une série de codes</h3>
          <p style={pSub}>Collez vos codes (un par ligne, ou séparés par virgule/point-virgule). Les doublons sont ignorés automatiquement. Les gros volumes (plusieurs milliers) sont ajoutés par lots.</p>
          <textarea value={bulk} onChange={e => setBulk(e.target.value)} rows={6} placeholder={"CODE-001\nCODE-002\nCODE-003"}
            style={{ width: "100%", padding: 12, borderRadius: 12, border: `1px solid ${C.line}`, background: C.black, color: C.cream, fontFamily: "monospace", fontSize: 14, boxSizing: "border-box", resize: "vertical" }} />
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 12 }}>
            <button onClick={handleAdd} disabled={adding} style={{ ...btnPrimary, width: "auto", margin: 0, opacity: adding ? 0.6 : 1 }}><Plus size={17} /> {adding ? "Ajout…" : "Ajouter au pool"}</button>
            {msg && <span style={{ color: C.green, fontSize: 13.5 }}>{msg}</span>}
          </div>
        </DarkCard>
      )}
    </div>
  );
}

function RegsTab({ total, searchRegistrations, fetchAllRegistrations, fetchRegistrationsPage }) {
  const PAGE = 50;
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState([]);
  const [loadingPage, setLoadingPage] = useState(true);
  const [q, setQ] = useState("");
  const [results, setResults] = useState(null); // null = pas de recherche
  const [searching, setSearching] = useState(false);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoadingPage(true);
    fetchRegistrationsPage(page * PAGE, PAGE).then(r => { if (alive) { setRows(r); setLoadingPage(false); } });
    return () => { alive = false; };
  }, [page]);

  async function doSearch() {
    const term = q.trim();
    if (!term) { setResults(null); return; }
    setSearching(true);
    const r = await searchRegistrations(term);
    setSearching(false);
    setResults(r);
  }

  async function exportCsv() {
    setExporting(true);
    const all = await fetchAllRegistrations();
    setExporting(false);
    const rowsCsv = [["Date", "Prénom", "Nom", "Licence", "E-mail", "Code", "Newsletter"]];
    all.forEach(r => rowsCsv.push([
      r.date ? new Date(r.date).toLocaleString("fr-FR") : "", r.prenom, r.nom, r.licence, r.email, r.code, r.newsletter ? "Oui" : "Non",
    ]));
    const csv = rowsCsv.map(row => row.map(c => `"${String(c ?? "").replace(/"/g, '""')}"`).join(";")).join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "attributions.csv"; a.click();
    URL.revokeObjectURL(url);
  }

  const isSearch = results !== null;
  const list = isSearch ? results : rows;
  const totalPages = Math.max(1, Math.ceil(total / PAGE));

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <DarkCard>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 10 }}>
          <h3 style={{ ...h3, margin: 0 }}>Attributions ({total})</h3>
          {total > 0 && <button onClick={exportCsv} disabled={exporting} style={{ ...btnGhostLight, opacity: exporting ? 0.6 : 1 }}><Download size={15} /> {exporting ? "Export…" : "Exporter en CSV (tout)"}</button>}
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === "Enter") doSearch(); }}
            placeholder="Rechercher un code, un e-mail ou un nom…" style={{ ...darkInput, flex: "1 1 240px" }} />
          <button onClick={doSearch} disabled={searching} style={{ ...btnGhostLight, opacity: searching ? 0.6 : 1 }}><Search size={15} /> {searching ? "…" : "Rechercher"}</button>
          {isSearch && <button onClick={() => { setQ(""); setResults(null); }} style={{ ...btnGhostLight }}>Effacer</button>}
        </div>
        <p style={{ ...pSub, marginTop: 8, marginBottom: 0 }}>Saisis un <b>code</b> pour voir à qui il a été attribué (ou un e-mail / nom).</p>
      </DarkCard>

      <DarkCard>
        <h3 style={{ ...h3 }}>{isSearch ? `Résultats (${list.length})` : "Inscriptions"}</h3>
        {(!isSearch && loadingPage) ? (
          <p style={pSub}>Chargement…</p>
        ) : list.length === 0 ? (
          <p style={pSub}>{isSearch ? "Aucun résultat." : "Aucune inscription pour l'instant."}</p>
        ) : (
          <>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}>
                <thead>
                  <tr style={{ textAlign: "left", color: C.gray, borderBottom: `1px solid ${C.line}` }}>
                    {["Date", "Nom complet", "Licence", "E-mail", "Code", "Newsletter"].map(h => <th key={h} style={{ padding: "8px 10px", fontWeight: 600 }}>{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {list.map(r => (
                    <tr key={r.id} style={{ borderBottom: `1px solid ${C.line}` }}>
                      <td style={td}>{r.date ? new Date(r.date).toLocaleDateString("fr-FR") : "—"}</td>
                      <td style={td}>{r.prenom} {r.nom}</td>
                      <td style={td}>{r.licence}</td>
                      <td style={td}>{r.email}</td>
                      <td style={{ ...td, color: C.green, fontWeight: 700 }}>{r.code}</td>
                      <td style={td}>{r.newsletter ? <Check size={16} color={C.green} /> : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!isSearch && totalPages > 1 && (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 14, marginTop: 16, flexWrap: "wrap" }}>
                <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} style={{ ...btnGhostLight, opacity: page === 0 ? 0.4 : 1 }}><ArrowLeft size={15} /> Précédent</button>
                <span style={{ color: C.gray, fontSize: 13.5 }}>Page {page + 1} / {totalPages}</span>
                <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} style={{ ...btnGhostLight, opacity: page >= totalPages - 1 ? 0.4 : 1 }}>Suivant →</button>
              </div>
            )}
          </>
        )}
      </DarkCard>
    </div>
  );
}

function PromoteTab({ slug }) {
  const [url, setUrl] = useState("");
  const [copied, setCopied] = useState("");
  const boxRef = useRef(null);

  useEffect(() => {
    if (typeof window !== "undefined") setUrl(`${window.location.origin}/${slug}`);
  }, [slug]);

  const flash = (k) => { setCopied(k); setTimeout(() => setCopied(""), 1500); };
  const getCanvas = () => boxRef.current?.querySelector("canvas");

  async function copyLink() {
    try { await navigator.clipboard.writeText(url); flash("link"); }
    catch (e) { window.prompt("Lien (copiez-le) :", url); }
  }
  function copyQR() {
    const cv = getCanvas(); if (!cv) return;
    cv.toBlob(async (blob) => {
      try {
        await navigator.clipboard.write([new window.ClipboardItem({ "image/png": blob })]);
        flash("qr");
      } catch (e) {
        console.error(e);
        alert("La copie d'image n'est pas supportée par ce navigateur. Utilisez « Télécharger ».");
      }
    });
  }
  function downloadQR() {
    const cv = getCanvas(); if (!cv) return;
    const a = document.createElement("a");
    a.href = cv.toDataURL("image/png");
    a.download = `qr-${slug}.png`;
    a.click();
  }

  if (!url) return <DarkCard><p style={pSub}>Préparation…</p></DarkCard>;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <DarkCard>
        <h3 style={h3}>Lien du formulaire</h3>
        <p style={pSub}>Partagez ce lien aux participants pour qu'ils reçoivent leur code.</p>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <code style={{ flex: "1 1 240px", minWidth: 0, background: C.black, border: `1px solid ${C.line}`, borderRadius: 10, padding: "10px 12px", color: C.cream, fontSize: 14, overflowX: "auto", whiteSpace: "nowrap" }}>{url}</code>
          <button onClick={copyLink} style={{ ...btnGhostLight }}>{copied === "link" ? "Copié !" : "Copier le lien"}</button>
        </div>
      </DarkCard>

      <DarkCard>
        <h3 style={h3}>QR code</h3>
        <p style={pSub}>À imprimer ou intégrer sur un support. Il ouvre directement le formulaire.</p>
        <div ref={boxRef} style={{ display: "inline-block", background: "#fff", padding: 16, borderRadius: 14 }}>
          <QRCodeCanvas value={url} size={220} level="M" />
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
          <button onClick={copyQR} style={{ ...btnGhostLight }}>{copied === "qr" ? "Copié !" : "Copier le QR"}</button>
          <button onClick={downloadQR} style={{ ...btnGhostLight }}><Download size={15} /> Télécharger (PNG)</button>
        </div>
      </DarkCard>
    </div>
  );
}

function EmailTab({ config, mutateCfg }) {
  const e = config.welcomeEmail;
  const sampleCode = (config.genericCode || "").trim() || "CODE-EXEMPLE";
  const sample = { prenom: "Camille", nom: "Durand", licence: "FED-1234-AB", code: sampleCode, email: "camille@exemple.fr" };
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 16 }}>
      <DarkCard>
        <h3 style={h3}>Personnaliser l'e-mail de bienvenue</h3>
        <p style={pSub}>Variables disponibles : {"{prenom}"}, {"{nom}"}, {"{licence}"}, {"{code}"}, {"{email}"}.</p>
        <label style={lbl}>Nom de l'expéditeur</label>
        <input value={e.fromName ?? ""} placeholder="BLACKROLL" onChange={ev => mutateCfg(c => { c.welcomeEmail.fromName = ev.target.value; })} style={darkInput} />
        <p style={{ ...pSub, marginTop: 6 }}>Nom affiché dans la boîte du destinataire (l'adresse reste noreply@perf360.fr).</p>
        <label style={{ ...lbl, marginTop: 14 }}>Adresse de réponse (Reply-To)</label>
        <input value={e.replyTo || ""} placeholder="contact@exemple.fr" onChange={ev => mutateCfg(c => { c.welcomeEmail.replyTo = ev.target.value; })} style={darkInput} />
        <p style={{ ...pSub, marginTop: 6 }}>Adresse qui recevra les réponses (et le désabonnement). L'expéditeur affiché reste noreply@perf360.fr.</p>
        <label style={{ ...lbl, marginTop: 14 }}>Objet</label>
        <input value={e.subject} onChange={ev => mutateCfg(c => { c.welcomeEmail.subject = ev.target.value; })} style={darkInput} />
        <label style={{ ...lbl, marginTop: 14 }}>Corps du message</label>
        <RichEditor value={e.body} onChange={(html) => mutateCfg(c => { c.welcomeEmail.body = html; })} />
        <div style={{ display: "flex", gap: 16, marginTop: 14, flexWrap: "wrap" }}>
          <div style={{ flex: "2 1 280px" }}>
            <label style={lbl}>URL du bouton</label>
            <input value={e.ctaUrl || ""} placeholder="https://… (laisser vide pour masquer le bouton)"
              onChange={ev => mutateCfg(c => { c.welcomeEmail.ctaUrl = ev.target.value; })} style={darkInput} />
          </div>
          <div style={{ flex: "1 1 180px" }}>
            <label style={lbl}>Libellé du bouton</label>
            <input value={e.ctaLabel || ""} placeholder="Profiter de mon code"
              onChange={ev => mutateCfg(c => { c.welcomeEmail.ctaLabel = ev.target.value; })} style={darkInput} />
          </div>
        </div>
        <p style={{ ...pSub, marginTop: 6 }}>Le bouton n'apparaît que si l'URL est renseignée (http/https). Les variables ({"{code}"}, etc.) sont acceptées dans l'URL.</p>
        <label style={{ ...lbl, marginTop: 14 }}>Bas de page (footer)</label>
        <input value={e.footer ?? ""} placeholder="Laisser vide pour masquer le bas de page"
          onChange={ev => mutateCfg(c => { c.welcomeEmail.footer = ev.target.value; })} style={darkInput} />
        <p style={{ ...pSub, marginTop: 6 }}>Petit texte gris sous la carte de l'e-mail. Vide = pas de bas de page.</p>
      </DarkCard>
      <DarkCard>
        <h3 style={h3}>Aperçu en direct</h3>
        <div style={{ border: `1px solid ${C.line}`, borderRadius: 14, overflow: "hidden", marginTop: 8 }}>
          <div style={{ background: C.black, color: C.cream, padding: "12px 16px", fontSize: 13, display: "flex", gap: 8, alignItems: "center", borderBottom: `1px solid ${C.line}` }}>
            <Mail size={15} color={C.green} /> {fillTemplate(e.subject, sample)}
          </div>
          {/* Rendu identique à l'e-mail réellement envoyé (même gabarit que la route serveur). */}
          <div dangerouslySetInnerHTML={{ __html: buildEmailHtml(
            fillTemplate(e.body, sample),
            fillTemplate(e.ctaUrl, sample),
            fillTemplate(e.ctaLabel, sample),
            config.headerImageUrl,
            config.federationName,
            e.footer,
          ) }} />
        </div>
      </DarkCard>
    </div>
  );
}

function LicenseCard({ config, mutateCfg }) {
  const l = config.license;
  const set = (patch) => mutateCfg(c => { c.license = { ...c.license, ...patch }; });
  return (
    <DarkCard>
      <h3 style={h3}>Numéro de licence</h3>
      <p style={pSub}>Cochez pour demander un numéro de licence et en définir la règle de validation. Décochez pour retirer le champ du formulaire.</p>
      <label style={{ display: "flex", gap: 10, alignItems: "flex-start", cursor: "pointer", marginBottom: l.enabled !== false ? 18 : 0 }}>
        <input type="checkbox" checked={l.enabled !== false} onChange={ev => set({ enabled: ev.target.checked })}
          style={{ marginTop: 2, width: 18, height: 18, accentColor: C.green }} />
        <span style={{ fontSize: 14, color: C.cream, lineHeight: 1.45 }}>
          Demander le numéro de licence
          <span style={{ display: "block", fontSize: 12.5, color: C.gray, marginTop: 2 }}>
            Décochez pour retirer complètement le champ « Numéro de licence » du formulaire.
          </span>
        </span>
      </label>

      {l.enabled === false ? (
        <p style={{ color: C.gray, fontSize: 14 }}>Le champ licence n'est pas demandé. La détection des doublons repose uniquement sur l'adresse e-mail.</p>
      ) : (<>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 18 }}>
        {[["none", "Aucune contrainte"], ["length", "Longueur / type"], ["mask", "Masque"]].map(([id, lab]) => (
          <button key={id} onClick={() => set({ mode: id })} style={{ padding: "9px 15px", borderRadius: 999, cursor: "pointer", fontSize: 13.5, fontWeight: 600, background: l.mode === id ? C.green : C.black, color: l.mode === id ? C.black : C.cream, borderWidth: 1, borderStyle: "solid", borderColor: l.mode === id ? C.green : C.line }}>{lab}</button>
        ))}
      </div>

      {l.mode === "length" && (
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          <div><label style={lbl}>Nombre exact de caractères (0 = libre)</label>
            <input type="number" value={l.exact} onChange={ev => set({ exact: ev.target.value })} style={{ ...darkInput, width: 120 }} /></div>
          <div><label style={lbl}>Type de caractères</label>
            <select value={l.charType} onChange={ev => set({ charType: ev.target.value })} style={{ ...darkInput, width: 220 }}>
              <option value="any">Tous</option>
              <option value="digits">Chiffres uniquement</option>
              <option value="letters">Lettres uniquement</option>
              <option value="alnum">Lettres et chiffres</option>
            </select></div>
        </div>
      )}

      {l.mode === "mask" && (
        <div>
          <label style={lbl}>Masque</label>
          <input value={l.mask} onChange={ev => set({ mask: ev.target.value })} style={{ ...darkInput, fontFamily: "monospace", maxWidth: 280 }} />
          <div style={{ marginTop: 12, padding: 14, background: C.black, borderRadius: 12, border: `1px solid ${C.line}`, fontSize: 13.5, color: C.gray, lineHeight: 1.7 }}>
            <b style={{ color: C.cream }}>Symboles</b> — <code>#</code> = un chiffre · <code>A</code> = une lettre · <code>*</code> = lettre ou chiffre · tout autre caractère est littéral.<br />
            Exemple <code style={{ color: C.green }}>{l.mask || "FED-####-AA"}</code> → un numéro valide ressemblera à <b style={{ color: C.cream }}>{maskDescription(l.mask || "FED-####-AA")}</b>.
          </div>
        </div>
      )}
      {l.mode === "none" && <p style={{ color: C.gray, fontSize: 14 }}>Tout numéro non vide est accepté.</p>}
      </>)}
    </DarkCard>
  );
}

function SettingsTab({ config, mutateCfg, resetAll, slug, campaignName, renameInstance, headerUsedElsewhere }) {
  const c = config;
  const set = (patch) => mutateCfg(cfg => Object.assign(cfg, patch));
  const [reset, setReset] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [upErr, setUpErr] = useState("");

  /* Chemin du fichier dans le bucket à partir de son URL publique (null si externe). */
  function storagePath(url) {
    const m = String(url || "").match(/\/storage\/v1\/object\/public\/ffbb-assets\/(.+)$/);
    return m ? m[1].split("?")[0] : null;
  }
  async function deleteStored(url) {
    const path = storagePath(url);
    if (!path) return;
    // Ne pas supprimer un fichier encore utilisé par une autre instance (ex. duplication).
    if (await headerUsedElsewhere(url)) return;
    const { error } = await supabase.storage.from("ffbb-assets").remove([path]);
    if (error) console.error("Suppression storage:", error);
  }

  async function handleRemove() {
    const prev = c.headerImageUrl;
    set({ headerImageUrl: "" });
    try { await deleteStored(prev); } catch (e) { console.error(e); }
  }

  async function handleUpload(file) {
    if (!file) return;
    setUpErr("");
    setUploading(true);
    const prev = c.headerImageUrl;
    try {
      const ext = (file.name.split(".").pop() || "png").toLowerCase();
      const path = `${slug}/header-${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from("ffbb-assets")
        .upload(path, file, { upsert: true, cacheControl: "3600", contentType: file.type || undefined });
      if (error) throw error;
      const { data } = supabase.storage.from("ffbb-assets").getPublicUrl(path);
      set({ headerImageUrl: data.publicUrl });
      if (prev && storagePath(prev) && storagePath(prev) !== path) deleteStored(prev).catch(() => {});
    } catch (e) {
      console.error(e);
      setUpErr("Échec du téléversement. Vérifiez que le bucket « ffbb-assets » existe et est public.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <DarkCard>
        <h3 style={h3}>Instance</h3>
        <label style={lbl}>Nom de l'instance</label>
        <input value={campaignName || ""} onChange={e => renameInstance(e.target.value)} placeholder="Nom de l'instance" style={darkInput} />
        <p style={{ ...pSub, marginTop: 6 }}>Identifiant d'URL (slug) : <code style={{ color: C.green }}>/{slug}</code> — non modifiable.</p>
      </DarkCard>
      <DarkCard>
        <h3 style={h3}>En-tête (logo)</h3>
        <p style={pSub}>Téléversez une image (PNG/JPG/SVG, max 5 Mo) ou collez une URL. Affichée sur le formulaire et en en-tête de l'e-mail. Sans image, c'est le texte alternatif ci-dessous qui s'affiche.</p>

        {c.headerImageUrl ? (
          <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", marginBottom: 14 }}>
            <div style={{ background: C.black, border: `1px solid ${C.line}`, borderRadius: 12, padding: "12px 16px" }}>
              <img src={c.headerImageUrl} alt="Aperçu logo" style={{ maxHeight: 48, maxWidth: 220, objectFit: "contain", display: "block" }} />
            </div>
            <button onClick={handleRemove} style={{ ...btnGhostLight, borderColor: "#ff7a6b", color: "#ff7a6b" }}>
              <Trash2 size={15} /> Retirer le logo
            </button>
          </div>
        ) : (
          <p style={{ ...pSub, marginTop: 0 }}>Aucun logo : le texte alternatif est utilisé.</p>
        )}

        <label style={{ ...btnGhostLight, display: "inline-flex", cursor: uploading ? "default" : "pointer", opacity: uploading ? 0.6 : 1 }}>
          <ImageIcon size={15} /> {uploading ? "Téléversement…" : "Téléverser une image"}
          <input type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" disabled={uploading}
            onChange={e => handleUpload(e.target.files?.[0])} style={{ display: "none" }} />
        </label>
        {upErr && <div style={{ color: "#ff7a6b", fontSize: 13, marginTop: 8 }}>{upErr}</div>}

        <label style={{ ...lbl, marginTop: 16 }}>…ou URL de l'image d'en-tête</label>
        <input value={c.headerImageUrl} placeholder="https://…/logo.png" onChange={e => set({ headerImageUrl: e.target.value })} style={darkInput} />

        <label style={{ ...lbl, marginTop: 16 }}>Texte alternatif à afficher en l'absence d'image</label>
        <input value={c.federationName || ""} placeholder="Nom à afficher si aucune image" onChange={e => set({ federationName: e.target.value })} style={darkInput} />
      </DarkCard>
      <DarkCard>
        <h3 style={h3}>Identité du formulaire</h3>
        <label style={lbl}>Titre du formulaire</label>
        <input value={c.formTitle || ""} placeholder="Inscription licencié" onChange={e => set({ formTitle: e.target.value })} style={darkInput} />
        <label style={{ ...lbl, marginTop: 14 }}>Texte d'introduction</label>
        <RichEditor value={c.formIntro} onChange={(html) => set({ formIntro: html })} variables={[]} />
        <label style={{ ...lbl, marginTop: 14 }}>Newsletter — phrase d'intro</label>
        <input value={c.newsletterIntro ?? ""} placeholder="Vous voulez en plus recevoir :" onChange={e => set({ newsletterIntro: e.target.value })} style={darkInput} />
        <label style={{ ...lbl, marginTop: 14 }}>Newsletter — texte</label>
        <textarea value={c.newsletterBullets ?? ""} rows={3} onChange={e => set({ newsletterBullets: e.target.value })} style={{ ...darkInput, resize: "vertical" }} />
        <label style={{ ...lbl, marginTop: 14 }}>Newsletter — libellé de la case</label>
        <textarea value={c.newsletterLabel} rows={2} onChange={e => set({ newsletterLabel: e.target.value })} style={{ ...darkInput, resize: "vertical" }} />
        <label style={{ ...lbl, marginTop: 14 }}>Lien « Protection des données » (RGPD)</label>
        <input value={c.privacyUrl ?? ""} placeholder="https://… (laisser vide pour masquer)" onChange={e => set({ privacyUrl: e.target.value })} style={darkInput} />
        <p style={{ ...pSub, marginTop: 6 }}>Affiché sous le bouton du formulaire. Vide = pas de lien.</p>
      </DarkCard>
      <LicenseCard config={config} mutateCfg={mutateCfg} />
      <DarkCard>
        <h3 style={h3}>Sécurité</h3>
        <label style={lbl}>Mot de passe administrateur (de cette instance)</label>
        <input value={c.adminPassword} onChange={e => set({ adminPassword: e.target.value })} style={{ ...darkInput, maxWidth: 280 }} />
      </DarkCard>
      <DarkCard>
        <h3 style={{ ...h3, color: "#ff7a6b" }}>Zone de réinitialisation</h3>
        <p style={pSub}>Efface tous les codes et toutes les inscriptions de cette instance (irréversible).</p>
        {!reset ? (
          <button onClick={() => setReset(true)} style={{ ...btnGhostLight, borderColor: "#ff7a6b", color: "#ff7a6b" }}><Trash2 size={15} /> Tout réinitialiser</button>
        ) : (
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={async () => { await resetAll(); setReset(false); }} style={{ ...btnPrimary, width: "auto", margin: 0, background: "#ff7a6b" }}>Confirmer la suppression</button>
            <button onClick={() => setReset(false)} style={{ ...btnGhostLight, margin: 0 }}>Annuler</button>
          </div>
        )}
      </DarkCard>
    </div>
  );
}
