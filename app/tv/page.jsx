"use client";
/*
 * perf360.fr/tv — écran d'affichage du Jukebox sur une télé connectée (navigateur
 * de la télé, clé TV) : adresse courte, code de la soirée saisi au pavé
 * numérique de l'écran (flèches + OK de la télécommande) ou au clavier ; le
 * dernier code est retenu pour la fois suivante.
 */
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { formatCode } from "@/components/jukebox/storage";

const LAST_KEY = "jukebox:tvCode";
const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "⌫", "0", "OK"];

export default function TvPage() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [last, setLast] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const firstKey = useRef(null);

  useEffect(() => {
    try { setLast(localStorage.getItem(LAST_KEY) || ""); } catch (e) { /* stockage indisponible */ }
    firstKey.current?.focus();
  }, []);

  const open = async (c) => {
    if (c.length !== 6 || busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/jukebox/${c}`, { cache: "no-store" });
      if (res.status === 404) throw new Error(`Aucune soirée avec le code ${formatCode(c)}.`);
      try { localStorage.setItem(LAST_KEY, c); } catch (e) { /* stockage indisponible */ }
      router.push(`/jukebox/${c}/ecran`);
    } catch (e) {
      setError(e.message || "Connexion impossible, réessayez.");
      setBusy(false);
    }
  };

  const press = (k) => {
    setError("");
    if (k === "⌫") setCode((c) => c.slice(0, -1));
    else if (k === "OK") open(code);
    else {
      const next = (code + k).slice(0, 6);
      setCode(next);
      if (next.length === 6) open(next); // 6 chiffres : ouverture directe
    }
  };

  // clavier physique ou touches chiffrées de la télécommande
  useEffect(() => {
    const onKey = (e) => {
      if (/^\d$/.test(e.key)) { e.preventDefault(); press(e.key); }
      else if (e.key === "Backspace") { e.preventDefault(); press("⌫"); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  const digits = code.padEnd(6, "·");
  return (
    <div className="min-h-screen bg-gradient-to-br from-fuchsia-700 via-purple-800 to-indigo-950 text-white flex items-center justify-center p-6">
      <div className="w-full max-w-4xl grid gap-10 md:grid-cols-2 items-center">
        <div className="text-center md:text-left space-y-5">
          <p className="text-6xl">🎶📺</p>
          <h1 className="text-5xl font-black">Jukebox sur la télé</h1>
          <p className="text-2xl text-white/80">Saisissez le code de la soirée, affiché dans la régie.</p>
          <p className="font-mono text-6xl font-black tracking-[0.25em]">
            {digits.slice(0, 3)} {digits.slice(3)}
          </p>
          {error && <p className="text-2xl text-amber-300">{error}</p>}
          {busy && <p className="text-2xl text-white/70">Ouverture…</p>}
          {last && !code && (
            <button onClick={() => open(last)}
              className="text-2xl font-bold bg-white/15 hover:bg-white/25 focus:bg-white focus:text-purple-900 outline-none rounded-full px-8 py-4">
              ▶ Reprendre la soirée {formatCode(last)}
            </button>
          )}
        </div>
        <div className="grid grid-cols-3 gap-4 max-w-sm mx-auto w-full">
          {KEYS.map((k, i) => (
            <button key={k} ref={i === 0 ? firstKey : null} onClick={() => press(k)} disabled={busy}
              className={`aspect-square rounded-3xl text-5xl font-black outline-none transition
                focus:scale-110 focus:ring-8 focus:ring-white ${k === "OK" ? "bg-green-500 hover:bg-green-600" : "bg-white/15 hover:bg-white/25"}
                ${k === "OK" && code.length !== 6 ? "opacity-40" : ""}`}>
              {k}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
