"use client";
/*
 * Super-admin du dispositif — gère les instances (campagnes).
 * Protégé par un mot de passe maître (ffbb_config id=1 → data.masterPassword).
 * Permet de lister, créer, dupliquer et supprimer des instances. Chaque instance
 * a ensuite son propre formulaire (/c/<slug>) et son propre admin (/c/<slug>/admin).
 *
 * Dispositif autonome : AUCUN lien vers l'accueil perf360.
 */
import { useState, useEffect } from "react";
import { Lock, Plus, ExternalLink, Copy, Trash2, Settings, Users } from "lucide-react";
import {
  C, PageShell, Loader, Card, DarkCard,
  btnPrimary, btnGhost, btnGhostLight, h3, pSub, lbl, darkInput, DEFAULT_CONFIG,
  listCampaigns, createCampaign, deleteCampaign, renameCampaign, loadMasterConfig, loadCampaignBySlug, RESERVED_SLUGS,
} from "../ffbb-test/shared";

function slugify(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export default function SuperAdminPage() {
  const [master, setMaster] = useState(null);
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [authed, setAuthed] = useState(false);

  async function refresh() {
    const list = await listCampaigns();
    setCampaigns(list);
  }

  useEffect(() => {
    (async () => {
      try {
        const [mc] = await Promise.all([loadMasterConfig()]);
        setMaster(mc);
        await refresh();
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <Loader />;

  if (!authed) {
    return (
      <PageShell>
        <MasterLogin master={master} onOk={() => setAuthed(true)} />
      </PageShell>
    );
  }

  return (
    <PageShell>
      <Dashboard campaigns={campaigns} refresh={refresh} />
    </PageShell>
  );
}

function MasterLogin({ master, onOk }) {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState(false);
  const tryLogin = () => (pw === (master?.masterPassword ?? "admin") ? onOk() : setErr(true));
  return (
    <div style={{ display: "flex", justifyContent: "center", padding: "60px 16px" }}>
      <div style={{ width: "100%", maxWidth: 380 }}>
        <Card>
          <div style={{ width: 46, height: 46, borderRadius: 12, background: C.ink, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 16 }}>
            <Lock size={22} color={C.green} />
          </div>
          <h2 style={{ fontSize: 22, fontWeight: 800, color: C.ink, margin: "0 0 4px", letterSpacing: "-0.4px" }}>Super-administration</h2>
          <p style={{ color: "#888", fontSize: 13.5, margin: "0 0 16px" }}>Gestion des instances</p>
          <input type="password" value={pw} placeholder="Mot de passe maître" onChange={e => { setPw(e.target.value); setErr(false); }}
            onKeyDown={e => { if (e.key === "Enter") tryLogin(); }}
            style={{ width: "100%", padding: "13px 15px", borderRadius: 12, border: `1.5px solid ${err ? "#b3261e" : C.cardLine}`, fontSize: 15, boxSizing: "border-box", color: C.ink, background: "#fff", outline: "none" }} />
          {err && <div style={{ color: "#b3261e", fontSize: 13, marginTop: 8 }}>Mot de passe incorrect.</div>}
          <button onClick={tryLogin} style={btnPrimary}>Se connecter</button>
        </Card>
      </div>
    </div>
  );
}

function Dashboard({ campaigns, refresh }) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [dupFrom, setDupFrom] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [confirmDel, setConfirmDel] = useState(null);

  const effectiveSlug = slug ? slugify(slug) : slugify(name);

  async function handleCreate() {
    setErr("");
    const s = effectiveSlug;
    if (!s) { setErr("Indiquez au moins un nom ou un slug."); return; }
    if (RESERVED_SLUGS.includes(s)) { setErr(`Le slug « ${s} » est réservé. Choisis-en un autre.`); return; }
    if (campaigns.some(c => c.slug === s)) { setErr(`Le slug « ${s} » existe déjà.`); return; }
    setBusy(true);
    try {
      let config;
      if (dupFrom) {
        const src = await loadCampaignBySlug(dupFrom);
        config = src ? structuredClone(src.config) : structuredClone(DEFAULT_CONFIG);
      } else {
        config = structuredClone(DEFAULT_CONFIG);
      }
      await createCampaign({ slug: s, name: name || s, config });
      setName(""); setSlug(""); setDupFrom("");
      await refresh();
    } catch (e) {
      console.error(e);
      setErr("Création impossible (slug déjà pris ?).");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(c) {
    setBusy(true);
    try {
      await deleteCampaign(c.id);
      setConfirmDel(null);
      await refresh();
    } catch (e) {
      console.error(e);
      setErr("Suppression impossible.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 920, margin: "0 auto", padding: "28px 16px 60px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 22 }}>
        <Settings size={22} color={C.green} />
        <h1 style={{ fontSize: 26, fontWeight: 800, margin: 0, letterSpacing: "-0.6px" }}>Instances</h1>
      </div>

      <DarkCard>
        <h3 style={h3}>Créer une instance</h3>
        <p style={pSub}>Une instance = un formulaire indépendant avec sa propre liste de codes, son branding et son e-mail.</p>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 240px" }}>
            <label style={lbl}>Nom</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Ex : Partenaire X 2026" style={darkInput} />
          </div>
          <div style={{ flex: "1 1 200px" }}>
            <label style={lbl}>Slug (URL)</label>
            <input value={slug} onChange={e => setSlug(e.target.value)} placeholder={effectiveSlug || "partenaire-x"} style={{ ...darkInput, fontFamily: "monospace" }} />
            {effectiveSlug && <div style={{ color: C.gray, fontSize: 12, marginTop: 4 }}>/{effectiveSlug}</div>}
          </div>
          <div style={{ flex: "1 1 200px" }}>
            <label style={lbl}>Dupliquer depuis (optionnel)</label>
            <select value={dupFrom} onChange={e => setDupFrom(e.target.value)} style={darkInput}>
              <option value="">— Config par défaut —</option>
              {campaigns.map(c => <option key={c.slug} value={c.slug}>{c.name || c.slug}</option>)}
            </select>
          </div>
        </div>
        {err && <div style={{ color: "#ff7a6b", fontSize: 13, marginTop: 10 }}>{err}</div>}
        <button onClick={handleCreate} disabled={busy} style={{ ...btnPrimary, width: "auto", marginTop: 14, opacity: busy ? 0.6 : 1 }}>
          <Plus size={17} /> Créer l'instance
        </button>
        {dupFrom && <p style={{ ...pSub, marginTop: 8 }}>La duplication copie le branding, les textes et l'e-mail — <b>pas</b> les codes ni les inscriptions.</p>}
      </DarkCard>

      <div style={{ height: 16 }} />

      <DarkCard>
        <h3 style={h3}>Instances existantes ({campaigns.length})</h3>
        {campaigns.length === 0 ? <p style={pSub}>Aucune instance.</p> : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 12 }}>
            {campaigns.map(c => (
              <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", padding: "12px 14px", background: C.black, border: `1px solid ${C.line}`, borderRadius: 12 }}>
                <div style={{ flex: "1 1 200px", minWidth: 0 }}>
                  <input defaultValue={c.name || ""} placeholder={c.slug}
                    onBlur={async (e) => { const v = e.target.value.trim(); if (v && v !== c.name) { try { await renameCampaign(c.id, v); await refresh(); } catch (err) { console.error(err); } } }}
                    style={{ width: "100%", background: C.ink, border: `1px solid ${C.line}`, borderRadius: 8, color: C.cream, fontWeight: 700, fontSize: 15, padding: "6px 8px", outline: "none", boxSizing: "border-box" }} />
                  <div style={{ color: C.gray, fontSize: 12.5, fontFamily: "monospace", marginTop: 3 }}>/{c.slug}</div>
                </div>
                <a href={`/${c.slug}`} target="_blank" rel="noreferrer" style={{ ...btnGhostLight, textDecoration: "none" }}><ExternalLink size={14} /> Formulaire</a>
                <a href={`/${c.slug}/admin`} target="_blank" rel="noreferrer" style={{ ...btnGhostLight, textDecoration: "none" }}><Users size={14} /> Admin</a>
                {confirmDel === c.id ? (
                  <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
                    <button onClick={() => handleDelete(c)} disabled={busy} style={{ ...btnGhostLight, borderColor: "#ff7a6b", color: "#ff7a6b" }}>Confirmer</button>
                    <button onClick={() => setConfirmDel(null)} style={btnGhostLight}>Annuler</button>
                  </span>
                ) : (
                  <button onClick={() => setConfirmDel(c.id)} style={{ ...btnGhostLight, borderColor: "#ff7a6b", color: "#ff7a6b" }}><Trash2 size={14} /> Supprimer</button>
                )}
              </div>
            ))}
          </div>
        )}
        <p style={{ ...pSub, marginTop: 14 }}>⚠️ Supprimer une instance efface aussi ses codes et ses inscriptions (irréversible).</p>
      </DarkCard>
    </div>
  );
}
