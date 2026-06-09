/*
 * Authentification serveur du dispositif FFBB (jetons signés HMAC).
 *
 * Les mots de passe (maître du super-admin, et admin de chaque instance) sont
 * vérifiés CÔTÉ SERVEUR contre la base (clé service_role). En cas de succès on
 * émet un jeton signé, court (12 h), que le client renvoie dans l'en-tête
 * `x-ffbb-auth`. Le secret de signature est dérivé de SUPABASE_SERVICE_ROLE_KEY
 * — pas de variable d'environnement supplémentaire à gérer.
 *
 * Portées (scope) :
 *   - "master"            → super-admin (gère toutes les instances)
 *   - "campaign:<id>"     → admin d'une instance précise
 * Un jeton "master" est accepté partout où un jeton de campagne est requis.
 */
import crypto from "node:crypto";

const TTL_MS = 12 * 60 * 60 * 1000; // 12 h

function secret() {
  const k = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!k) throw new Error("SUPABASE_SERVICE_ROLE_KEY manquant — auth impossible.");
  // Dérive une clé HMAC dédiée (ne ré-emploie pas la clé brute telle quelle).
  return crypto.createHash("sha256").update("ffbb-auth|" + k).digest();
}

function b64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlJson(obj) {
  return b64url(JSON.stringify(obj));
}

/* Signe un payload arbitraire (avec expiration). */
function sign(payload) {
  const body = b64urlJson(payload);
  const sig = b64url(crypto.createHmac("sha256", secret()).update(body).digest());
  return `${body}.${sig}`;
}

/* Émet un jeton signé pour une portée donnée. */
export function signToken(scope) {
  return sign({ scope, exp: nowMs() + TTL_MS });
}

export function masterToken() {
  return signToken("master");
}
export function campaignToken(cid) {
  return signToken("campaign:" + cid);
}

/* Jeton court (30 min) autorisant le renvoi du code à un inscrit précis, après
   conflit de licence — le client ne reçoit jamais l'e-mail brut de l'autre
   personne, seulement ce jeton opaque. */
export function resendToken(rid, cid) {
  return sign({ kind: "resend", rid, cid, exp: nowMs() + 30 * 60 * 1000 });
}
export function verifyResendToken(token) {
  const p = verifyToken(token);
  return p && p.kind === "resend" && p.rid != null ? p : null;
}

/* Vérifie la signature + l'expiration. Retourne le payload, ou null si invalide. */
export function verifyToken(token) {
  if (!token || typeof token !== "string" || !token.includes(".")) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = b64url(crypto.createHmac("sha256", secret()).update(body).digest());
  // Comparaison à temps constant.
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(body.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString());
  } catch (e) {
    return null;
  }
  if (!payload || typeof payload.exp !== "number" || payload.exp < nowMs()) return null;
  return payload;
}

/* `Date.now()` isolé pour rester testable. */
function nowMs() {
  return Date.now();
}

/* --------------------- GARDES POUR LES ROUTES --------------------- */
function tokenFromReq(req) {
  return req.headers.get("x-ffbb-auth") || "";
}

/* Exige un jeton super-admin valide. Retourne le payload, sinon null. */
export function requireMaster(req) {
  const p = verifyToken(tokenFromReq(req));
  return p && p.scope === "master" ? p : null;
}

/* Exige un jeton autorisant l'instance `cid` (jeton de cette campagne OU master). */
export function requireCampaign(req, cid) {
  const p = verifyToken(tokenFromReq(req));
  if (!p) return null;
  if (p.scope === "master") return p;
  if (p.scope === "campaign:" + cid) return p;
  return null;
}
