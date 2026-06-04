import { NextResponse } from "next/server";

/*
 * Le domaine blackroll-codes.com est dédié à l'app multi-instances de codes.
 * - Racine "/" → page d'accueil interne (/accueil) via rewrite (l'URL reste "/").
 * - /manifest.json → manifeste non-installable (pas de proposition d'installer
 *   la PWA "perf360" quand on scanne un QR / ouvre le formulaire).
 * Les autres chemins passent normalement. Sur perf360.vercel.app, rien n'est modifié.
 */
export function middleware(request) {
  const host = (request.headers.get("host") || "").toLowerCase();
  if (!host.includes("blackroll-codes.com")) return NextResponse.next();

  const path = request.nextUrl.pathname;

  if (path === "/manifest.json") {
    // display:"browser" + pas d'icônes → non installable (supprime le prompt PWA perf360).
    return new NextResponse(JSON.stringify({ name: "BLACKROLL Codes", display: "browser" }), {
      status: 200,
      headers: { "content-type": "application/manifest+json" },
    });
  }

  if (path === "/") {
    const url = request.nextUrl.clone();
    url.pathname = "/accueil";
    return NextResponse.rewrite(url);
  }

  return NextResponse.next();
}

export const config = { matcher: ["/", "/manifest.json"] };
