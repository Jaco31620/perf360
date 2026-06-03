"use client";
/*
 * Pièces communes au formulaire public (page.jsx) et à l'espace admin (admin/page.jsx)
 * du dispositif licenciés FFBB × BLACKROLL. Constantes de marque, helpers purs
 * (validation licence, gabarits e-mail, masques), composants UI et styles.
 *
 * NB : ce dispositif est volontairement autonome — aucun lien vers l'accueil perf360.
 */
import { Check } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { escapeHtml, looksLikeHtml } from "./emailTemplate";

export const C = {
  black: "#0A0A0A",
  ink: "#161614",
  cream: "#FEFFF0",
  green: "#1BE299",
  greenDark: "#0fae77",
  gray: "#8c8c84",
  line: "#2b2b28",
  cardLine: "#e6e6da",
};

export const nb = " ";

export const OLD_INTRO =
  "Saisissez vos informations pour recevoir votre code personnel unique par e-mail.";
export const NEW_INTRO =
  "Dans le cadre du partenariat entre BLACKROLL et la FFBB, les licenciés bénéficient de 15" +
  nb +
  "% de réduction sur leurs achats. Renseignez vos informations ci-dessous pour recevoir votre code de réduction personnel par e-mail.";

/* Configuration éditable par défaut — stockée dans ffbb_config.data (id = 1). */
export const DEFAULT_CONFIG = {
  adminPassword: "admin",
  federationName: "VOTRE FÉDÉRATION",
  headerImageUrl: "",
  formTitle: "Inscription licencié",
  formIntro: NEW_INTRO,
  /* Distribution : "unique" = un code différent par inscrit (liste ffbb_codes) ;
     "generic" = le même code (genericCode) pour tout le monde. */
  codeMode: "unique",
  genericCode: "",
  newsletterLabel:
    "Je souhaite également recevoir la newsletter et les actualités par e-mail.",
  welcomeEmail: {
    replyTo: "jaco.barral@blackroll.com",
    ctaUrl: "",
    ctaLabel: "Profiter de mon code",
    subject: "Bienvenue {prenom}, voici votre code de réduction",
    /* Corps en HTML (éditeur WYSIWYG). Le {code} est mis en avant dans un encadré. */
    body:
      "Bonjour {prenom},<br><br>" +
      "Bienvenue et merci pour votre inscription. Dans le cadre du partenariat <b>FFBB × BLACKROLL</b>, vous bénéficiez de <b>15" +
      nb +
      "% de réduction</b> sur vos achats.<br><br>" +
      "Voici votre code personnel unique" +
      nb +
      ":" +
      "<div style=\"margin:16px 0;padding:14px 18px;background:#0A0A0A;border-radius:12px;text-align:center;font-size:22px;font-weight:800;letter-spacing:2px;color:#1BE299\">{code}</div>" +
      "Conservez-le précieusement" +
      nb +
      ": il est valable pour vous seul·e.<br><br>" +
      "À très bientôt,<br>L'équipe",
  },
  license: { enabled: true, mode: "none", exact: 8, charType: "alnum", mask: "FED-####-AA" },
};

/* --------------------------- HELPERS PURS --------------------------- */
export function fillTemplate(str, v) {
  return (str || "")
    .replace(/\{prenom\}/gi, v.prenom || "")
    .replace(/\{nom\}/gi, v.nom || "")
    .replace(/\{licence\}/gi, v.licence || "")
    .replace(/\{code\}/gi, v.code || "")
    .replace(/\{email\}/gi, v.email || "");
}

export function maskDescription(mask) {
  return mask.replace(/#/g, "0").replace(/A/g, "X").replace(/\*/g, "?");
}

export function maskEmail(email) {
  const at = (email || "").indexOf("@");
  if (at < 1) return email || "";
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const dot = domain.lastIndexOf(".");
  const name = dot > 0 ? domain.slice(0, dot) : domain;
  const tld = dot > 0 ? domain.slice(dot) : "";
  const ml = local[0] + "***";
  const md = (name[0] || "") + "***" + tld;
  return ml + "@" + md;
}

export function validateLicense(value, cfg) {
  if (cfg.enabled === false) return { ok: true }; // demande de licence désactivée
  const val = (value || "").trim();
  if (!val) return { ok: false, msg: "Le numéro de licence est requis." };
  if (cfg.mode === "none") return { ok: true };
  if (cfg.mode === "length") {
    if (cfg.exact && Number(cfg.exact) > 0 && val.length !== Number(cfg.exact))
      return { ok: false, msg: `Le numéro doit comporter exactement ${cfg.exact} caractères.` };
    const tests = {
      digits: { re: /^\d+$/, label: "uniquement des chiffres" },
      letters: { re: /^[A-Za-zÀ-ÿ]+$/, label: "uniquement des lettres" },
      alnum: { re: /^[A-Za-z0-9]+$/, label: "des lettres et chiffres" },
      any: { re: /.*/, label: "" },
    };
    const t = tests[cfg.charType] || tests.any;
    if (!t.re.test(val)) return { ok: false, msg: `Le numéro doit contenir ${t.label}.` };
    return { ok: true };
  }
  if (cfg.mode === "mask") {
    const m = cfg.mask || "";
    if (val.length !== m.length)
      return { ok: false, msg: `Format attendu : ${maskDescription(m)} (${m.length} caractères).` };
    for (let i = 0; i < m.length; i++) {
      const c = m[i], x = val[i];
      if (c === "#" && !/\d/.test(x)) return { ok: false, msg: `Format attendu : ${maskDescription(m)}` };
      if (c === "A" && !/[A-Za-z]/.test(x)) return { ok: false, msg: `Format attendu : ${maskDescription(m)}` };
      if (c === "*" && !/[A-Za-z0-9]/.test(x)) return { ok: false, msg: `Format attendu : ${maskDescription(m)}` };
      if (!"#A*".includes(c) && x.toUpperCase() !== c.toUpperCase())
        return { ok: false, msg: `Format attendu : ${maskDescription(m)}` };
    }
    return { ok: true };
  }
  return { ok: true };
}

/* --------------------------- CONFIG SUPABASE --------------------------- */
/* Fusionne la config stockée par-dessus les valeurs par défaut + migrations douces. */
export function normalizeConfig(stored) {
  const cfg = {
    ...structuredClone(DEFAULT_CONFIG),
    ...(stored || {}),
    welcomeEmail: { ...DEFAULT_CONFIG.welcomeEmail, ...((stored && stored.welcomeEmail) || {}) },
    license: { ...DEFAULT_CONFIG.license, ...((stored && stored.license) || {}) },
  };
  if (cfg.formIntro === OLD_INTRO) cfg.formIntro = NEW_INTRO;
  if (cfg.headerImageUrl === undefined) cfg.headerImageUrl = "";
  // Migration : ancien texte d'intro du formulaire en texte brut → HTML (une seule fois).
  if (cfg.formIntro && !looksLikeHtml(cfg.formIntro)) {
    cfg.formIntro = escapeHtml(cfg.formIntro).replace(/\n/g, "<br>");
  }
  // Migration : ancien corps d'e-mail en texte brut → HTML (une seule fois).
  if (cfg.welcomeEmail.body && !looksLikeHtml(cfg.welcomeEmail.body)) {
    cfg.welcomeEmail.body = escapeHtml(cfg.welcomeEmail.body).replace(/\n/g, "<br>");
  }
  return cfg;
}

export async function loadConfig() {
  const { data, error } = await supabase
    .from("ffbb_config")
    .select("data")
    .eq("id", 1)
    .maybeSingle();
  if (error) throw error;
  return data && data.data ? normalizeConfig(data.data) : structuredClone(DEFAULT_CONFIG);
}

/* --------------------------- CAMPAGNES (INSTANCES) --------------------------- */
/* Chaque instance du dispositif = une ligne ffbb_campaigns (slug + config jsonb).
   Les codes/inscriptions sont rattachés par campaign_id. */

export async function loadCampaignBySlug(slug) {
  const { data, error } = await supabase
    .from("ffbb_campaigns")
    .select("id,slug,name,config")
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return { id: data.id, slug: data.slug, name: data.name, config: normalizeConfig(data.config) };
}

export async function listCampaigns() {
  const { data, error } = await supabase
    .from("ffbb_campaigns")
    .select("id,slug,name,created_at")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data || [];
}

/* Crée une instance. config optionnelle (sinon valeurs par défaut). */
export async function createCampaign({ slug, name, config }) {
  const { data, error } = await supabase
    .from("ffbb_campaigns")
    .insert({ slug, name: name || slug, config: config || structuredClone(DEFAULT_CONFIG) })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/* Supprime une instance (cascade : ses codes + inscriptions via FK on delete cascade). */
export async function deleteCampaign(id) {
  const { error } = await supabase.from("ffbb_campaigns").delete().eq("id", id);
  if (error) throw error;
}

/* Réglages globaux (ffbb_config id=1) : mot de passe du super-admin. */
export async function loadMasterConfig() {
  const { data, error } = await supabase.from("ffbb_config").select("data").eq("id", 1).maybeSingle();
  if (error) throw error;
  return data?.data || { masterPassword: "admin" };
}

/* Construit et envoie l'e-mail de bienvenue réel via la route serveur /api/ffbb/send. */
export async function sendWelcomeEmail(reg, config) {
  const vars = {
    prenom: reg.prenom,
    nom: reg.nom,
    licence: reg.licence,
    code: reg.code,
    email: reg.email,
  };
  const res = await fetch("/api/ffbb/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      to: reg.email,
      replyTo: config.welcomeEmail.replyTo,
      headerImageUrl: config.headerImageUrl,
      altText: config.federationName,
      ctaUrl: fillTemplate(config.welcomeEmail.ctaUrl, vars),
      ctaLabel: fillTemplate(config.welcomeEmail.ctaLabel, vars),
      subject: fillTemplate(config.welcomeEmail.subject, vars),
      body: fillTemplate(config.welcomeEmail.body, vars),
    }),
  });
  if (!res.ok) {
    let detail = "";
    try { detail = (await res.json()).error || ""; } catch (e) {}
    throw new Error(detail || "Échec de l'envoi de l'e-mail.");
  }
}

/* --------------------------- EN-TÊTE CO-BRANDÉ --------------------------- */
export function BasketballIcon() {
  return (
    <svg width="30" height="30" viewBox="0 0 100 100" fill="none" style={{ flexShrink: 0 }}>
      <circle cx="50" cy="50" r="44" stroke={C.cream} strokeWidth="7" />
      <line x1="50" y1="6" x2="50" y2="94" stroke={C.cream} strokeWidth="7" />
      <line x1="6" y1="50" x2="94" y2="50" stroke={C.cream} strokeWidth="7" />
      <path d="M22 12 C42 36 42 64 22 88" stroke={C.cream} strokeWidth="7" />
      <path d="M78 12 C58 36 58 64 78 88" stroke={C.cream} strokeWidth="7" />
    </svg>
  );
}

export function CoBrandHeader({ config }) {
  if (config.headerImageUrl) {
    return (
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 26 }}>
        <img src={config.headerImageUrl} alt={config.federationName || "FFBB × BLACKROLL"} style={{ display: "block", margin: "0 auto", maxHeight: 56, maxWidth: "100%", objectFit: "contain" }} />
      </div>
    );
  }
  // Pas d'image : texte alternatif s'il est renseigné, sinon lockup FFBB × BLACKROLL.
  if (config.federationName && config.federationName.trim()) {
    return (
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 26 }}>
        <span style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-0.5px", color: C.cream, textAlign: "center" }}>{config.federationName}</span>
      </div>
    );
  }
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 18, marginBottom: 26, flexWrap: "wrap" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
        <BasketballIcon />
        <span style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-0.5px" }}>FFBB</span>
        <span style={{ fontSize: 8.5, lineHeight: 1.2, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.3 }}>
          Fédération<br />Française de<br />Basketball
        </span>
      </div>
      <div style={{ width: 1.5, height: 36, background: C.cream, opacity: 0.45 }} />
      <span style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-0.5px" }}>BLACKROLL<sup style={{ fontSize: 10 }}>®</sup></span>
    </div>
  );
}

/* --------------------------- HABILLAGE PAGE --------------------------- */
export function PageShell({ children }) {
  return (
    <div style={{ background: C.black, minHeight: "100vh", fontFamily: "Helvetica Neue, Helvetica, Arial, sans-serif", color: C.cream }}>
      {children}
    </div>
  );
}

export function Loader() {
  return (
    <div style={{ background: C.black, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", color: C.cream, fontFamily: "Helvetica Neue, Arial, sans-serif" }}>
      Chargement…
    </div>
  );
}

/* --------------------------- HELPERS UI --------------------------- */
export function Card({ children }) {
  return <div style={{ background: C.cream, borderRadius: 22, padding: 30, boxShadow: "0 10px 40px rgba(0,0,0,0.4)" }}>{children}</div>;
}
export function DarkCard({ children }) {
  return <div style={{ background: C.ink, borderRadius: 18, padding: 24, border: `1px solid ${C.line}` }}>{children}</div>;
}
export function Field({ label, children }) {
  return <label style={{ flex: 1, display: "block" }}><span style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: "#555", marginBottom: 6 }}>{label}</span>{children}</label>;
}
export function Stat({ label, value, accent }) {
  return (
    <div style={{ background: accent ? C.green : C.ink, color: accent ? C.black : C.cream, borderRadius: 16, padding: "16px 18px", border: accent ? "none" : `1px solid ${C.line}` }}>
      <div style={{ fontSize: 30, fontWeight: 800, letterSpacing: "-1px" }}>{value}</div>
      <div style={{ fontSize: 12.5, opacity: accent ? 0.75 : 0.65, fontWeight: 600 }}>{label}</div>
    </div>
  );
}

export const btnPrimary = { width: "100%", marginTop: 18, padding: "14px 18px", borderRadius: 999, border: "none", background: C.green, color: C.black, fontSize: 15.5, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 };
export const btnGhost = { width: "100%", padding: "12px 18px", borderRadius: 999, border: `1.5px solid ${C.cardLine}`, background: "transparent", color: "#555", fontSize: 14, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 };
export const btnGhostLight = { padding: "9px 15px", borderRadius: 999, border: `1px solid ${C.line}`, background: "transparent", color: C.cream, fontSize: 13.5, fontWeight: 600, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6 };
export const h3 = { fontSize: 17, fontWeight: 700, color: C.cream, margin: "0 0 4px", letterSpacing: "-0.3px" };
export const pSub = { color: C.gray, fontSize: 13.5, margin: "0 0 14px", lineHeight: 1.5 };
export const lbl = { display: "block", fontSize: 12.5, fontWeight: 600, color: C.gray, marginBottom: 6 };
export const td = { padding: "10px 10px", color: C.cream };
export const darkInput = { width: "100%", padding: "11px 13px", borderRadius: 10, border: `1px solid ${C.line}`, background: C.black, color: C.cream, fontSize: 14.5, boxSizing: "border-box", outline: "none" };

/* Ré-export pratique pour les pages. */
export { Check };
