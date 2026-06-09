"use client";
/*
 * Pièces communes au formulaire public (page.jsx) et à l'espace admin (admin/page.jsx)
 * du dispositif licenciés FFBB × BLACKROLL. Constantes de marque, helpers purs
 * (validation licence, masques), composants UI et styles.
 *
 * SÉCURITÉ : depuis l'activation de la RLS, le client ne touche PLUS la base en
 * direct. Tous les accès données passent par des routes serveur (/api/ffbb/*),
 * authentifiées par un jeton signé (cf. couche « ACCÈS SERVEUR » plus bas).
 * Constantes & normalisation de config : module pur ./configDefaults (partagé serveur).
 *
 * NB : ce dispositif est volontairement autonome — aucun lien vers l'accueil perf360.
 */
import { Check } from "lucide-react";
import { supabase } from "@/lib/supabase";
import {
  nb, OLD_INTRO, NEW_INTRO, OLD_NEWSLETTER_LABEL, DEFAULT_CONFIG,
  normalizeConfig, RESERVED_SLUGS,
} from "./configDefaults";

/* Ré-export pour les pages/écrans existants (la définition vit dans ./configDefaults). */
export { nb, OLD_INTRO, NEW_INTRO, OLD_NEWSLETTER_LABEL, DEFAULT_CONFIG, normalizeConfig, RESERVED_SLUGS };

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

/* ===================================================================== */
/* ACCÈS SERVEUR — jetons d'auth (sessionStorage) + appels aux routes API */
/* ===================================================================== */
const TKEY_MASTER = "ffbb_mt";
const tkeyCampaign = (slug) => "ffbb_ct_" + slug;

export function setMasterToken(t) {
  try { t ? sessionStorage.setItem(TKEY_MASTER, t) : sessionStorage.removeItem(TKEY_MASTER); } catch (e) {}
}
export function getMasterToken() {
  try { return sessionStorage.getItem(TKEY_MASTER); } catch (e) { return null; }
}
export function setCampaignToken(slug, t) {
  try { t ? sessionStorage.setItem(tkeyCampaign(slug), t) : sessionStorage.removeItem(tkeyCampaign(slug)); } catch (e) {}
}
export function getCampaignToken(slug) {
  try { return sessionStorage.getItem(tkeyCampaign(slug)); } catch (e) { return null; }
}

/* Appel POST JSON générique. Joint le jeton dans l'en-tête x-ffbb-auth si fourni.
   Lève une Error (avec .status) si la réponse n'est pas 2xx. */
async function api(path, { body, token } = {}) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { "x-ffbb-auth": token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try { data = await res.json(); } catch (e) {}
  if (!res.ok) {
    const err = new Error(data.error || "Une erreur est survenue.");
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

/* --- Connexions (vérif. du mot de passe CÔTÉ SERVEUR) --- */
export async function authMaster(password, masterTok) {
  const data = await api("/api/ffbb/auth", { body: { scope: "master", password }, token: masterTok });
  setMasterToken(data.token);
  return data.token;
}
export async function authCampaign(slug, { password, token } = {}) {
  const data = await api("/api/ffbb/auth", { body: { scope: "campaign", slug, password }, token });
  setCampaignToken(slug, data.token);
  return data; // { token, campaign: { id, slug, name, config } }
}

/* --- Opérations admin d'instance (jeton de campagne explicite) --- */
export function adminCall(action, cid, extra, token) {
  return api("/api/ffbb/admin", { body: { action, cid, ...(extra || {}) }, token });
}

/* --- Opérations super-admin (jeton master joint automatiquement) --- */
function superCall(action, extra) {
  return api("/api/ffbb/super", { body: { action, ...(extra || {}) }, token: getMasterToken() });
}

/* --------------------------- CONFIG / CAMPAGNES --------------------------- */
/* Charge une instance par slug pour le formulaire public — config SANS SECRET
   (le mot de passe admin est retiré côté serveur). Retourne null si introuvable. */
export async function loadCampaignBySlug(slug) {
  const res = await fetch(`/api/ffbb/campaign?slug=${encodeURIComponent(slug)}`);
  let data = {};
  try { data = await res.json(); } catch (e) {}
  if (!res.ok) throw new Error(data.error || "Chargement impossible.");
  return data.campaign || null;
}

export async function listCampaigns() {
  return (await superCall("list")).campaigns || [];
}

export async function createCampaign({ slug, name, config }) {
  return (await superCall("create", { slug, name, config })).campaign;
}

export async function deleteCampaign(id) {
  await superCall("delete", { id });
}

export async function loadMasterConfig() {
  return (await superCall("loadMaster")).master;
}

export async function saveMasterConfig(patch) {
  return (await superCall("saveMaster", { patch })).master;
}

/* Mot de passe aléatoire robuste (sans caractères ambigus 0/O/1/l/I) pour
   initialiser le mot de passe admin d'une nouvelle instance. */
export function generatePassword(len = 14) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  let out = "";
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    const a = new Uint32Array(len);
    crypto.getRandomValues(a);
    for (let i = 0; i < len; i++) out += chars[a[i] % chars.length];
  } else {
    for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

/* Copie l'image d'en-tête vers un fichier propre à la nouvelle instance (duplication).
   Opération Storage (bucket public ffbb-assets) — conservée côté client. Retourne la
   nouvelle URL, ou null (URL externe / échec) → on garde alors l'URL d'origine. */
export async function duplicateHeaderImage(url, newSlug) {
  const m = String(url || "").match(/\/storage\/v1\/object\/public\/ffbb-assets\/(.+)$/);
  if (!m) return null;
  const srcPath = m[1].split("?")[0];
  const ext = (srcPath.split(".").pop() || "png").toLowerCase();
  const destPath = `${newSlug}/header-${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from("ffbb-assets").copy(srcPath, destPath);
  if (error) { console.error("Copie image:", error); return null; }
  const { data } = supabase.storage.from("ffbb-assets").getPublicUrl(destPath);
  return data?.publicUrl || null;
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
