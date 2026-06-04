"use client";
/*
 * Espace administrateur d'une instance (campagne). Reçoit `campaign`
 * = { id, slug, name, config }. La config est sauvegardée (débounce) dans
 * ffbb_campaigns.config ; pool de codes et inscriptions sont scopés par
 * campaign_id ; les logos sont rangés dans le bucket sous le préfixe du slug.
 *
 * Dispositif autonome : navigation interne uniquement, AUCUN lien vers l'accueil perf360.
 */
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Lock, Plus, Download, Mail, Settings, Tag, Users, Trash2, ArrowLeft, Hash, Image as ImageIcon, LogOut, Eye, QrCode } from "lucide-react";
import { QRCodeCanvas } from "qrcode.react";
import { supabase } from "@/lib/supabase";
import {
  C, fillTemplate, maskDescription,
  Card, DarkCard, Stat, Check, PageShell, Loader,
  btnPrimary, btnGhost, btnGhostLight, h3, pSub, lbl, td, darkInput,
} from "./shared";
import RichEditor from "./RichEditor";
import { buildEmailHtml } from "./emailTemplate";

export default function AdminApp({ campaign }) {
  const cid = campaign.id;
  const slug = campaign.slug;
  const [config, setConfig] = useState(campaign.config);
  const [codes, setCodes] = useState([]);
  const [registrations, setRegistrations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [authed, setAuthed] = useState(false);
  const [campaignName, setCampaignName] = useState(campaign.name);
  const router = useRouter();
  const saveTimer = useRef(null);
  const nameTimer = useRef(null);

  /* Renommage de l'instance (colonne ffbb_campaigns.name), débouncé. */
  function renameInstance(n) {
    setCampaignName(n);
    if (nameTimer.current) clearTimeout(nameTimer.current);
    nameTimer.current = setTimeout(() => {
      supabase.from("ffbb_campaigns").update({ name: n }).eq("id", cid)
        .then(({ error }) => { if (error) console.error(error); });
    }, 500);
  }

  useEffect(() => {
    // Authentifié au super-admin (mot de passe maître) → accès direct sans le mot de passe d'instance.
    if (typeof window !== "undefined" && sessionStorage.getItem("ffbb_super_admin") === "1") setAuthed(true);
    (async () => {
      try {
        const [codesRes, regsRes] = await Promise.all([
          supabase.from("ffbb_codes").select("*").eq("campaign_id", cid).order("code"),
          supabase.from("ffbb_registrations").select("*").eq("campaign_id", cid).order("created_at", { ascending: true }),
        ]);
        setCodes(codesRes.data || []);
        setRegistrations((regsRes.data || []).map(r => ({ ...r, date: r.created_at })));
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    })();
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      if (nameTimer.current) clearTimeout(nameTimer.current);
    };
  }, [cid]);

  /* Sauvegarde débouncée de la config dans ffbb_campaigns. */
  function persistConfig(cfg) {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      supabase.from("ffbb_campaigns").update({ config: cfg }).eq("id", cid)
        .then(({ error }) => { if (error) console.error(error); });
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

  async function addCodes(list) {
    const existing = new Set(codes.map(c => c.code.toLowerCase()));
    const fresh = [];
    list.forEach(code => {
      if (!existing.has(code.toLowerCase())) { fresh.push(code); existing.add(code.toLowerCase()); }
    });
    if (fresh.length) {
      const rows = fresh.map(code => ({ campaign_id: cid, code, status: "available", assigned_to: null }));
      const { data, error } = await supabase.from("ffbb_codes").insert(rows).select();
      if (error) { console.error(error); return { added: 0, total: list.length, error: true }; }
      setCodes(prev => [...prev, ...(data || [])]);
    }
    return { added: fresh.length, total: list.length };
  }

  async function removeCode(code) {
    const { error } = await supabase.from("ffbb_codes").delete().eq("campaign_id", cid).eq("code", code).eq("status", "available");
    if (error) { console.error(error); return; }
    setCodes(prev => prev.filter(c => c.code !== code));
  }

  async function resetAll() {
    const r1 = await supabase.from("ffbb_registrations").delete().eq("campaign_id", cid);
    const r2 = await supabase.from("ffbb_codes").delete().eq("campaign_id", cid);
    if (r1.error || r2.error) { console.error(r1.error || r2.error); return; }
    setCodes([]); setRegistrations([]);
  }

  if (loading) return <Loader />;

  return (
    <PageShell>
      {authed ? (
        <Admin
          config={config} codes={codes} registrations={registrations} slug={slug} campaignName={campaignName} renameInstance={renameInstance}
          mutateCfg={mutateCfg} addCodes={addCodes} removeCode={removeCode} resetAll={resetAll}
          onExit={() => router.push(`/${slug}`)}
          onLogout={() => { try { sessionStorage.removeItem("ffbb_super_admin"); } catch (e) {} setAuthed(false); }}
        />
      ) : (
        <AdminLogin
          config={config} campaignName={campaignName}
          onOk={() => setAuthed(true)}
          onBack={() => router.push(`/${slug}`)}
        />
      )}
    </PageShell>
  );
}

/* ----------------------------- ADMIN LOGIN ----------------------------- */
function AdminLogin({ config, campaignName, onOk, onBack }) {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState(false);
  const tryLogin = () => (pw === config.adminPassword ? onOk() : setErr(true));
  return (
    <div style={{ display: "flex", justifyContent: "center", padding: "60px 16px" }}>
      <div style={{ width: "100%", maxWidth: 380 }}>
        <Card>
          <div style={{ width: 46, height: 46, borderRadius: 12, background: C.ink, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 16 }}>
            <Lock size={22} color={C.green} />
          </div>
          <h2 style={{ fontSize: 22, fontWeight: 800, color: C.ink, margin: "0 0 4px", letterSpacing: "-0.4px" }}>Espace administrateur</h2>
          {campaignName && <p style={{ color: "#888", fontSize: 13.5, margin: "0 0 16px" }}>{campaignName}</p>}
          <input type="password" value={pw} placeholder="Mot de passe" onChange={e => { setPw(e.target.value); setErr(false); }}
            onKeyDown={e => { if (e.key === "Enter") tryLogin(); }}
            style={{ width: "100%", padding: "13px 15px", borderRadius: 12, border: `1.5px solid ${err ? "#b3261e" : C.cardLine}`, fontSize: 15, boxSizing: "border-box", color: C.ink, background: "#fff", outline: "none" }} />
          {err && <div style={{ color: "#b3261e", fontSize: 13, marginTop: 8 }}>Mot de passe incorrect.</div>}
          <button onClick={tryLogin} style={btnPrimary}>Se connecter</button>
          <button onClick={onBack} style={{ ...btnGhost, marginTop: 8 }}><ArrowLeft size={15} /> Retour au formulaire</button>
        </Card>
      </div>
    </div>
  );
}

/* ----------------------------- ADMIN ----------------------------- */
function Admin({ config, codes, registrations, slug, campaignName, renameInstance, mutateCfg, addCodes, removeCode, resetAll, onExit, onLogout }) {
  const [tab, setTab] = useState("codes");
  const available = codes.filter(c => c.status === "available").length;
  const assigned = codes.filter(c => c.status === "assigned").length;
  const newsletterCount = registrations.filter(r => r.newsletter).length;

  const tabs = [
    { id: "codes", label: "Codes", icon: Tag },
    { id: "regs", label: "Attributions", icon: Users },
    { id: "promote", label: "Promouvoir", icon: QrCode },
    { id: "email", label: "E-mail", icon: Mail },
    { id: "license", label: "Licence", icon: Hash },
    { id: "settings", label: "Réglages", icon: Settings },
  ];

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

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 12, marginBottom: 24 }}>
        {(config.codeMode || "unique") === "unique" ? (
          <>
            <Stat label="Codes disponibles" value={available} accent />
            <Stat label="Codes attribués" value={assigned} />
          </>
        ) : (
          <Stat label="Distribution" value="Générique" accent />
        )}
        <Stat label="Inscrits" value={registrations.length} />
        <Stat label="Opt-in newsletter" value={newsletterCount} />
      </div>

      <div style={{ display: "flex", gap: 6, marginBottom: 20, flexWrap: "wrap" }}>
        {tabs.map(t => {
          const I = t.icon, on = tab === t.id;
          return (
            <button key={t.id} onClick={() => setTab(t.id)}
              style={{ display: "flex", alignItems: "center", gap: 7, padding: "9px 15px", borderRadius: 999, border: "none", cursor: "pointer", fontSize: 14, fontWeight: 600, background: on ? C.green : C.ink, color: on ? C.black : C.cream }}>
              <I size={15} /> {t.label}
            </button>
          );
        })}
      </div>

      {tab === "codes" && <CodesTab config={config} codes={codes} addCodes={addCodes} removeCode={removeCode} mutateCfg={mutateCfg} />}
      {tab === "regs" && <RegsTab registrations={registrations} />}
      {tab === "promote" && <PromoteTab slug={slug} />}
      {tab === "email" && <EmailTab config={config} codes={codes} mutateCfg={mutateCfg} />}
      {tab === "license" && <LicenseTab config={config} mutateCfg={mutateCfg} />}
      {tab === "settings" && <SettingsTab config={config} mutateCfg={mutateCfg} resetAll={resetAll} slug={slug} campaignName={campaignName} renameInstance={renameInstance} />}
    </div>
  );
}

function CodesTab({ config, codes, addCodes, removeCode, mutateCfg }) {
  const [bulk, setBulk] = useState("");
  const [msg, setMsg] = useState("");
  const mode = config.codeMode || "unique";

  async function handleAdd() {
    const list = bulk.split(/[\n,;]+/).map(s => s.trim()).filter(Boolean);
    if (!list.length) return;
    const { added, total, error } = await addCodes(list);
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
            <button key={id} onClick={() => mutateCfg(c => { c.codeMode = id; })}
              style={{ padding: "9px 15px", borderRadius: 999, cursor: "pointer", fontSize: 13.5, fontWeight: 600, background: mode === id ? C.green : C.black, color: mode === id ? C.black : C.cream, borderWidth: 1, borderStyle: "solid", borderColor: mode === id ? C.green : C.line }}>{lab}</button>
          ))}
        </div>
        <p style={{ ...pSub, marginTop: 12, marginBottom: 0 }}>
          {mode === "generic"
            ? "Le même code est distribué à tous les inscrits — aucune liste nécessaire."
            : "Chaque inscrit reçoit un code différent, tiré de la liste ci-dessous. Pool vide ⇒ le formulaire indique qu'aucun code n'est disponible."}
        </p>
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
          <p style={pSub}>Collez vos codes (un par ligne, ou séparés par une virgule). Les doublons sont ignorés automatiquement.</p>
          <textarea value={bulk} onChange={e => setBulk(e.target.value)} rows={5} placeholder={"CODE-001\nCODE-002\nCODE-003"}
            style={{ width: "100%", padding: 12, borderRadius: 12, border: `1px solid ${C.line}`, background: C.black, color: C.cream, fontFamily: "monospace", fontSize: 14, boxSizing: "border-box", resize: "vertical" }} />
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 12 }}>
            <button onClick={handleAdd} style={{ ...btnPrimary, width: "auto", margin: 0 }}><Plus size={17} /> Ajouter au pool</button>
            {msg && <span style={{ color: C.green, fontSize: 13.5 }}>{msg}</span>}
          </div>

          <div style={{ height: 1, background: C.line, margin: "24px 0" }} />
          <h3 style={h3}>Pool de codes ({codes.length})</h3>
          {codes.length === 0 ? <p style={pSub}>Aucun code pour l'instant.</p> : (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
              {codes.map(c => (
                <span key={c.code} style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "6px 10px 6px 12px", borderRadius: 999, fontSize: 13, fontWeight: 600, background: c.status === "available" ? "rgba(27,226,153,0.12)" : C.black, color: c.status === "available" ? C.green : C.gray, border: `1px solid ${c.status === "available" ? "rgba(27,226,153,0.3)" : C.line}` }}>
                  {c.code}{c.status === "assigned" && " · attribué"}
                  {c.status === "available" && <Trash2 size={13} style={{ cursor: "pointer", opacity: 0.7 }} onClick={() => removeCode(c.code)} />}
                </span>
              ))}
            </div>
          )}
        </DarkCard>
      )}
    </div>
  );
}

function RegsTab({ registrations }) {
  function exportCsv() {
    const rows = [["Date", "Prénom", "Nom", "Licence", "E-mail", "Code", "Newsletter"]];
    registrations.forEach(r => rows.push([
      r.date ? new Date(r.date).toLocaleString("fr-FR") : "", r.prenom, r.nom, r.licence, r.email, r.code, r.newsletter ? "Oui" : "Non",
    ]));
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "attributions.csv"; a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <DarkCard>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
        <h3 style={{ ...h3, margin: 0 }}>Codes attribués ({registrations.length})</h3>
        {registrations.length > 0 && <button onClick={exportCsv} style={{ ...btnGhostLight }}><Download size={15} /> Exporter en CSV</button>}
      </div>
      {registrations.length === 0 ? <p style={pSub}>Aucune inscription pour l'instant.</p> : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}>
            <thead>
              <tr style={{ textAlign: "left", color: C.gray, borderBottom: `1px solid ${C.line}` }}>
                {["Date", "Nom complet", "Licence", "E-mail", "Code", "Newsletter"].map(h => <th key={h} style={{ padding: "8px 10px", fontWeight: 600 }}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {registrations.slice().reverse().map(r => (
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
      )}
    </DarkCard>
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

function EmailTab({ config, codes, mutateCfg }) {
  const e = config.welcomeEmail;
  const sample = { prenom: "Camille", nom: "Durand", licence: "FED-1234-AB", code: codes[0]?.code || "CODE-001", email: "camille@exemple.fr" };
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 16 }}>
      <DarkCard>
        <h3 style={h3}>Personnaliser l'e-mail de bienvenue</h3>
        <p style={pSub}>Variables disponibles : {"{prenom}"}, {"{nom}"}, {"{licence}"}, {"{code}"}, {"{email}"}.</p>
        <label style={lbl}>Adresse de réponse (Reply-To)</label>
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

function LicenseTab({ config, mutateCfg }) {
  const l = config.license;
  const set = (patch) => mutateCfg(c => { c.license = { ...c.license, ...patch }; });
  return (
    <DarkCard>
      <h3 style={h3}>Numéro de licence</h3>
      <p style={pSub}>Choisissez si le formulaire public demande un numéro de licence, et la règle de validation.</p>

      <label style={{ display: "flex", gap: 10, alignItems: "flex-start", cursor: "pointer", marginBottom: 18 }}>
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

function SettingsTab({ config, mutateCfg, resetAll, slug, campaignName, renameInstance }) {
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
        <label style={{ ...lbl, marginTop: 14 }}>Libellé de l'opt-in newsletter</label>
        <textarea value={c.newsletterLabel} rows={2} onChange={e => set({ newsletterLabel: e.target.value })} style={{ ...darkInput, resize: "vertical" }} />
      </DarkCard>
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
