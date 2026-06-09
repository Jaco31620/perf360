"use client";
/*
 * Super-admin du dispositif — gère les instances (campagnes).
 * Protégé par un mot de passe maître vérifié CÔTÉ SERVEUR (ffbb_config id=1 →
 * data.masterPassword) ; un jeton master signé est ensuite joint aux opérations
 * (/api/ffbb/super). Permet de lister, créer, dupliquer et supprimer des instances.
 *
 * Dispositif autonome : AUCUN lien vers l'accueil perf360.
 */
import { useState, useEffect } from "react";
import { Lock, Plus, ExternalLink, Trash2, Settings, LogOut, Key, Mail, Copy, ShieldCheck } from "lucide-react";
import {
  C, PageShell, Loader, Card, DarkCard,
  btnPrimary, btnGhost, btnGhostLight, h3, pSub, lbl, darkInput, DEFAULT_CONFIG,
  listCampaigns, createCampaign, deleteCampaign, loadMasterConfig, saveMasterConfig, RESERVED_SLUGS, generatePassword, duplicateHeaderImage,
  authMaster, getMasterToken, setMasterToken,
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

  /* Charge instances + réglages maître (nécessite un jeton master valide). */
  async function loadData() {
    const [list, mc] = await Promise.all([listCampaigns(), loadMasterConfig()]);
    setCampaigns(list);
    setMaster(mc);
  }
  async function refresh() {
    setCampaigns(await listCampaigns());
  }

  useEffect(() => {
    let alive = true;
    (async () => {
      // Session super-admin déjà ouverte (jeton en sessionStorage) → entrée directe.
      if (!getMasterToken()) { if (alive) setLoading(false); return; }
      try {
        await loadData();
        if (alive) setAuthed(true);
      } catch (e) {
        console.error(e);
        setMasterToken(null); // jeton invalide/expiré
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  if (loading) return <Loader />;

  if (!authed) {
    return (
      <PageShell>
        <MasterLogin onAuthed={async () => { await loadData(); setAuthed(true); }} />
      </PageShell>
    );
  }

  return (
    <PageShell>
      <Dashboard
        campaigns={campaigns}
        refresh={refresh}
        master={master}
        onMasterChange={setMaster}
        onLogout={() => { setMasterToken(null); setAuthed(false); }}
      />
    </PageShell>
  );
}

function MasterLogin({ onAuthed }) {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState(false);
  const [busy, setBusy] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [recoverMsg, setRecoverMsg] = useState("");

  async function tryLogin() {
    if (busy) return;
    setBusy(true); setErr(false);
    try {
      await authMaster(pw);     // vérifie le mot de passe côté serveur + stocke le jeton
      await onAuthed();
    } catch (e) {
      setErr(true);
      setBusy(false);
    }
  }

  async function recover() {
    setRecovering(true); setRecoverMsg("");
    try {
      const res = await fetch("/api/ffbb/admin-recover", { method: "POST" });
      const data = await res.json();
      if (res.ok) setRecoverMsg(`✅ Le mot de passe a été envoyé à ${data.hint || "l'adresse du propriétaire"}.`);
      else setRecoverMsg(`⚠️ ${data.error || "Envoi impossible."}`);
    } catch (e) {
      setRecoverMsg("⚠️ Envoi impossible.");
    } finally {
      setRecovering(false);
    }
  }
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
          <button onClick={tryLogin} disabled={busy} style={{ ...btnPrimary, opacity: busy ? 0.6 : 1 }}>{busy ? "Connexion…" : "Se connecter"}</button>
          <button onClick={recover} disabled={recovering}
            style={{ background: "none", border: "none", color: "#888", fontSize: 13, textDecoration: "underline", cursor: "pointer", marginTop: 12, padding: 0, width: "100%", textAlign: "center" }}>
            {recovering ? "Envoi en cours…" : "Mot de passe oublié ?"}
          </button>
          {recoverMsg && <div style={{ fontSize: 13, marginTop: 10, color: recoverMsg.startsWith("✅") ? "#0a7d4f" : "#b3261e", textAlign: "center" }}>{recoverMsg}</div>}
        </Card>
      </div>
    </div>
  );
}

function Dashboard({ campaigns, refresh, master, onMasterChange, onLogout }) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [dupFrom, setDupFrom] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [confirmDel, setConfirmDel] = useState(null);
  const [created, setCreated] = useState(null);   // {name, slug, password} après création
  const [copiedId, setCopiedId] = useState(null);
  const [invite, setInvite] = useState(null);     // {name, slug, password} → modal d'envoi des accès

  const effectiveSlug = slug ? slugify(slug) : slugify(name);

  async function copyText(t) {
    try { await navigator.clipboard.writeText(t); return true; } catch (e) { return false; }
  }
  async function copyPw(c) {
    const pw = c.config?.adminPassword || "";
    if (await copyText(pw)) { setCopiedId(c.id); setTimeout(() => setCopiedId(null), 1500); }
    else window.prompt("Mot de passe (copiez-le) :", pw);
  }

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
        // Clone à partir de l'instance source déjà en mémoire (config complète).
        const src = campaigns.find(c => c.slug === dupFrom);
        config = src ? structuredClone(src.config) : structuredClone(DEFAULT_CONFIG);
        // Image d'en-tête : copie propre à la nouvelle instance (indépendance).
        if (config.headerImageUrl) {
          const copied = await duplicateHeaderImage(config.headerImageUrl, s);
          if (copied) config.headerImageUrl = copied;
        }
      } else {
        config = structuredClone(DEFAULT_CONFIG);
      }
      const password = generatePassword();
      config.adminPassword = password;          // mot de passe robuste, indépendant de la source dupliquée
      const finalName = name || s;
      await createCampaign({ slug: s, name: finalName, config });
      setCreated({ name: finalName, slug: s, password });
      setName(""); setSlug(""); setDupFrom("");
      await refresh();
    } catch (e) {
      console.error(e);
      setErr(e?.data?.error || "Création impossible (slug déjà pris ?).");
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
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 22 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Settings size={22} color={C.green} />
          <h1 style={{ fontSize: 26, fontWeight: 800, margin: 0, letterSpacing: "-0.6px" }}>Instances</h1>
        </div>
        <button onClick={onLogout} style={{ ...btnGhostLight }}><LogOut size={15} /> Se déconnecter</button>
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

        {created && (
          <div style={{ marginTop: 14, background: "rgba(27,226,153,0.1)", border: `1px solid ${C.green}`, borderRadius: 12, padding: "12px 14px" }}>
            <div style={{ fontSize: 14, color: C.cream, marginBottom: 8 }}>
              ✅ Instance « <b>{created.name}</b> » créée. Mot de passe administrateur :
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <code style={{ background: C.black, border: `1px solid ${C.line}`, borderRadius: 8, padding: "6px 10px", color: C.green, fontSize: 15, letterSpacing: "0.5px" }}>{created.password}</code>
              <button onClick={async () => { if (await copyText(created.password)) { setCopiedId("banner"); setTimeout(() => setCopiedId(null), 1500); } }} style={{ ...btnGhostLight }}>
                <Key size={14} /> {copiedId === "banner" ? "Copié !" : "Copier"}
              </button>
              <button onClick={() => setInvite({ name: created.name, slug: created.slug, password: created.password })} style={{ ...btnGhostLight }}>
                <Mail size={14} /> Envoyer les accès
              </button>
            </div>
            <p style={{ ...pSub, marginTop: 8, marginBottom: 0 }}>Communique-le à l'admin de l'instance — il pourra le changer ensuite (Réglages → Sécurité). Toi (super-admin) n'en as pas besoin pour entrer.</p>
          </div>
        )}
      </DarkCard>

      <div style={{ height: 16 }} />

      <DarkCard>
        <h3 style={h3}>Instances existantes ({campaigns.length})</h3>
        {campaigns.length === 0 ? <p style={pSub}>Aucune instance.</p> : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 12 }}>
            {campaigns.map(c => (
              <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", padding: "12px 14px", background: C.black, border: `1px solid ${C.line}`, borderRadius: 12 }}>
                <a href={`/${c.slug}/admin`} title="Ouvrir l'admin de cette instance"
                  style={{ flex: "1 1 200px", minWidth: 0, display: "block", textDecoration: "none", cursor: "pointer" }}>
                  <div style={{ fontWeight: 700, color: C.cream, fontSize: 15 }}>{c.name || c.slug}</div>
                  <div style={{ color: C.gray, fontSize: 12.5, fontFamily: "monospace", marginTop: 3 }}>/{c.slug}</div>
                  <div style={{ color: C.gray, fontSize: 11.5, marginTop: 2 }}>Créée le {c.created_at ? new Date(c.created_at).toLocaleDateString("fr-FR") : "—"}</div>
                </a>
                <a href={`/${c.slug}`} target="_blank" rel="noreferrer" style={{ ...btnGhostLight, textDecoration: "none" }}><ExternalLink size={14} /> Formulaire</a>
                <button onClick={() => copyPw(c)} title="Copier le mot de passe admin de cette instance" style={{ ...btnGhostLight }}><Key size={14} /> {copiedId === c.id ? "Copié !" : "Mot de passe"}</button>
                <button onClick={() => setInvite({ name: c.name || c.slug, slug: c.slug, password: c.config?.adminPassword || "" })} title="Envoyer les accès par e-mail" style={{ ...btnGhostLight }}><Mail size={14} /> Accès</button>
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

      <div style={{ height: 16 }} />

      <SecurityCard master={master} onMasterChange={onMasterChange} />

      {invite && <InviteModal invite={invite} onClose={() => setInvite(null)} />}
    </div>
  );
}

/* Sécurité du super-admin : changer le mot de passe maître (ffbb_config id=1).
   Le mot de passe protège l'accès à TOUTES les instances — à garder fort. */
function SecurityCard({ master, onMasterChange }) {
  const current = master?.masterPassword ?? "admin";
  const isDefault = current === "admin";
  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  async function save() {
    setErr(""); setMsg("");
    if (pw1.length < 6) { setErr("Le mot de passe doit faire au moins 6 caractères."); return; }
    if (pw1 !== pw2) { setErr("Les deux mots de passe ne correspondent pas."); return; }
    setBusy(true);
    try {
      const next = await saveMasterConfig({ masterPassword: pw1 });
      onMasterChange?.(next);
      setPw1(""); setPw2("");
      setMsg("Mot de passe maître mis à jour.");
      setTimeout(() => setMsg(""), 3000);
    } catch (e) {
      console.error(e);
      setErr("Enregistrement impossible.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <DarkCard>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <ShieldCheck size={18} color={C.green} />
        <h3 style={{ ...h3, margin: 0 }}>Sécurité</h3>
      </div>
      <p style={{ ...pSub, marginTop: 8 }}>Mot de passe maître du super-admin — il protège l'accès à toutes les instances.</p>
      {isDefault && (
        <div style={{ background: "rgba(255,122,107,0.12)", border: "1px solid #ff7a6b", borderRadius: 10, padding: "10px 12px", margin: "0 0 14px", color: "#ffb3a8", fontSize: 13 }}>
          ⚠️ Le mot de passe est actuellement la valeur par défaut <code>admin</code>. Change-le.
        </div>
      )}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 220px" }}>
          <label style={lbl}>Nouveau mot de passe</label>
          <input type={show ? "text" : "password"} value={pw1} onChange={e => { setPw1(e.target.value); setErr(""); }} style={darkInput} />
        </div>
        <div style={{ flex: "1 1 220px" }}>
          <label style={lbl}>Confirmer</label>
          <input type={show ? "text" : "password"} value={pw2} onChange={e => { setPw2(e.target.value); setErr(""); }}
            onKeyDown={e => { if (e.key === "Enter") save(); }} style={darkInput} />
        </div>
      </div>
      <label style={{ display: "inline-flex", alignItems: "center", gap: 7, color: C.gray, fontSize: 13, marginTop: 10, cursor: "pointer" }}>
        <input type="checkbox" checked={show} onChange={e => setShow(e.target.checked)} /> Afficher les mots de passe
      </label>
      {err && <div style={{ color: "#ff7a6b", fontSize: 13, marginTop: 10 }}>{err}</div>}
      {msg && <div style={{ color: C.green, fontSize: 13, marginTop: 10 }}>✅ {msg}</div>}
      <button onClick={save} disabled={busy || !pw1} style={{ ...btnPrimary, width: "auto", marginTop: 14, opacity: busy || !pw1 ? 0.6 : 1 }}>
        <Key size={16} /> Enregistrer le mot de passe
      </button>
    </DarkCard>
  );
}

/* Modal d'envoi des accès d'une instance à son admin (super-admin only).
   E-mail prérempli + modifiable ; envoi via la messagerie de l'utilisateur (mailto)
   ou copie — pas via un noreply, donc adapté à un message interne. */
function InviteModal({ invite, onClose }) {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const formUrl = `${origin}/${invite.slug}`;
  const adminUrl = `${origin}/${invite.slug}/admin`;
  const defaultBody =
`Bonjour,

Voici vos accès pour gérer l'instance « ${invite.name} » de l'outil BLACKROLL Codes.

- Formulaire public (à diffuser) : ${formUrl}
- Espace d'administration : ${adminUrl}
- Mot de passe administrateur : ${invite.password}

Un QR code du formulaire (à imprimer ou afficher) est disponible dans l'espace d'administration, onglet « Promouvoir ».

Depuis l'espace d'administration, vous pouvez gérer les codes, consulter les inscriptions, et personnaliser l'e-mail et le formulaire. Vous pouvez changer ce mot de passe dans Réglages > Sécurité.

Bonne gestion,`;

  const [to, setTo] = useState("");
  const [subject, setSubject] = useState(`Vos accès — ${invite.name} (BLACKROLL Codes)`);
  const [body, setBody] = useState(defaultBody);
  const [copied, setCopied] = useState(false);

  function openMail() {
    const url = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    const a = document.createElement("a");
    a.href = url; a.click();
  }
  async function copyAll() {
    const text = `Objet : ${subject}\n\n${body}`;
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch (e) { window.prompt("Copiez le message :", text); }
  }

  return (
    <div onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, zIndex: 50 }}>
      <div onClick={e => e.stopPropagation()}
        style={{ width: "100%", maxWidth: 580, maxHeight: "90vh", overflowY: "auto", background: C.ink, border: `1px solid ${C.line}`, borderRadius: 18, padding: 24 }}>
        <h3 style={h3}>Envoyer les accès — {invite.name}</h3>
        <p style={pSub}>E-mail prérempli et modifiable. « Ouvrir dans ma messagerie » l'ouvre dans ton client (Outlook, Gmail…) — il part donc de <b>ta</b> boîte. Sinon, copie-le.</p>

        <label style={lbl}>Destinataire</label>
        <input value={to} onChange={e => setTo(e.target.value)} placeholder="prenom.nom@exemple.com" style={darkInput} />

        <label style={{ ...lbl, marginTop: 12 }}>Objet</label>
        <input value={subject} onChange={e => setSubject(e.target.value)} style={darkInput} />

        <label style={{ ...lbl, marginTop: 12 }}>Message</label>
        <textarea value={body} rows={12} onChange={e => setBody(e.target.value)} style={{ ...darkInput, resize: "vertical", fontFamily: "inherit" }} />

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 16 }}>
          <button onClick={openMail} style={{ ...btnPrimary, width: "auto", margin: 0 }}><Mail size={16} /> Ouvrir dans ma messagerie</button>
          <button onClick={copyAll} style={{ ...btnGhostLight }}><Copy size={15} /> {copied ? "Copié !" : "Copier"}</button>
          <button onClick={onClose} style={{ ...btnGhostLight }}>Fermer</button>
        </div>
      </div>
    </div>
  );
}
