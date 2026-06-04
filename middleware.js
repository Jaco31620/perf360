import { NextResponse } from "next/server";

/*
 * Le domaine blackroll-codes.com est dédié à l'app multi-instances de codes.
 * Sur ce domaine, la racine "/" affiche la page d'accueil interne (/accueil)
 * via un rewrite (l'URL reste "/"). Les autres chemins (/<slug>, /admin, /api/…)
 * passent normalement. Sur perf360.vercel.app, rien n'est modifié.
 */
export function middleware(request) {
  const host = (request.headers.get("host") || "").toLowerCase();
  if (host.includes("blackroll-codes.com")) {
    const url = request.nextUrl.clone();
    url.pathname = "/accueil";
    return NextResponse.rewrite(url);
  }
  return NextResponse.next();
}

// Ne s'exécute que sur la racine — les autres routes ne sont pas touchées.
export const config = { matcher: ["/"] };
