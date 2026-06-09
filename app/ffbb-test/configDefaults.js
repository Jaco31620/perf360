/*
 * Configuration par défaut + normalisation du dispositif FFBB — module PUR
 * (pas de React, pas de "use client"). Partagé entre le client (shared.jsx, qui
 * le ré-exporte) et les routes serveur (qui doivent normaliser la config avant
 * de l'utiliser pour l'e-mail ou de la renvoyer au formulaire public).
 */
import { escapeHtml, looksLikeHtml } from "./emailTemplate";

export const nb = " ";

export const OLD_INTRO =
  "Saisissez vos informations pour recevoir votre code personnel unique par e-mail.";
export const NEW_INTRO =
  "Dans le cadre du partenariat entre BLACKROLL et la FFBB, les licenciés bénéficient de 15" +
  nb +
  "% de réduction sur leurs achats. Renseignez vos informations ci-dessous pour recevoir votre code de réduction personnel par e-mail.";

export const OLD_NEWSLETTER_LABEL =
  "Je souhaite également recevoir la newsletter et les actualités par e-mail.";

/* Configuration éditable par défaut — stockée dans ffbb_config.data (id = 1)
   et dans chaque ffbb_campaigns.config. */
export const DEFAULT_CONFIG = {
  adminPassword: "admin",
  federationName: "VOTRE FÉDÉRATION",
  headerImageUrl: "",
  formTitle: "Inscription licencié",
  formIntro: NEW_INTRO,
  codeMode: "unique",
  genericCode: "",
  newsletterIntro: "Vous voulez en plus recevoir :",
  newsletterBullets:
    "- les nouveautés produits en avant-première\n" +
    "- des conseils d'experts en récupération, sommeil et performance\n" +
    "- les offres et concours réservés aux abonnés",
  newsletterLabel: "Je souhaite m'abonner à la newsletter BLACKROLL",
  privacyUrl: "https://blackroll.com/fr/service/protection-des-donnees",
  welcomeEmail: {
    fromName: "BLACKROLL",
    replyTo: "jaco.barral@blackroll.com",
    ctaUrl: "",
    ctaLabel: "Profiter de mon code",
    footer: "Dispositif licenciés FFBB × BLACKROLL.",
    subject: "Bienvenue {prenom}, voici votre code de réduction",
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

/* Fusionne la config stockée par-dessus les valeurs par défaut + migrations douces. */
export function normalizeConfig(stored) {
  const cfg = {
    ...structuredClone(DEFAULT_CONFIG),
    ...(stored || {}),
    welcomeEmail: { ...DEFAULT_CONFIG.welcomeEmail, ...((stored && stored.welcomeEmail) || {}) },
    license: { ...DEFAULT_CONFIG.license, ...((stored && stored.license) || {}) },
  };
  if (cfg.formIntro === OLD_INTRO) cfg.formIntro = NEW_INTRO;
  if (cfg.newsletterLabel === OLD_NEWSLETTER_LABEL) cfg.newsletterLabel = DEFAULT_CONFIG.newsletterLabel;
  if (cfg.headerImageUrl === undefined) cfg.headerImageUrl = "";
  if (cfg.formIntro && !looksLikeHtml(cfg.formIntro)) {
    cfg.formIntro = escapeHtml(cfg.formIntro).replace(/\n/g, "<br>");
  }
  if (cfg.welcomeEmail.body && !looksLikeHtml(cfg.welcomeEmail.body)) {
    cfg.welcomeEmail.body = escapeHtml(cfg.welcomeEmail.body).replace(/\n/g, "<br>");
  }
  return cfg;
}

/* Config sans secret, pour exposition publique (formulaire) : retire le mot de
   passe admin de l'instance. */
export function publicConfig(cfg) {
  const { adminPassword, ...rest } = cfg || {};
  return rest;
}

/* Slugs interdits à la création : ils correspondent à de vraies routes. */
export const RESERVED_SLUGS = [
  "admin", "api", "c", "ffbb-test", "respiration", "soutenir",
  "connexion", "auth", "ami-invisible", "accueil", "_next", "favicon.ico",
  "robots.txt", "sitemap.xml", "www",
];
