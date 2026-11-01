"use client";
/*
 * perf360.fr/tv — écran d'affichage du Jukebox sur une télé connectée (navigateur
 * de la télé, clé TV) : QR code à scanner avec le téléphone, qui choisit la
 * soirée (jumelage, /api/jukebox/tv), ou code saisi au pavé numérique de
 * l'écran (flèches + OK de la télécommande) ; dernier code retenu.
 */
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import { formatCode, setAdminToken, getAdminToken } from "@/components/jukebox/storage";

const LAST_KEY = "jukebox:tvCode";
const SOUND_KEY = "jukebox:tvSound"; // dernière soirée ouverte en mode son
const PAIR_KEY = "jukebox:tvPair";
const newPairId = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => "abcdefghijkmnpqrstuvwxyz23456789"[b % 32]).join("");
const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "⌫", "0", "OK"];

export default function TvPage() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [last, setLast] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [pair, setPair] = useState("");
  const [origin, setOrigin] = useState("");
  const firstKey = useRef(null);

  useEffect(() => {
    let id = "";
    try {
      setLast(localStorage.getItem(LAST_KEY) || "");
      id = localStorage.getItem(PAIR_KEY) || "";
      if (!id) { id = newPairId(); localStorage.setItem(PAIR_KEY, id); }
    } catch (e) { id ||= newPairId(); /* stockage indisponible */ }
    setPair(id);
    setOrigin(window.location.origin);
    firstKey.current?.focus();
  }, []);

  // jumelage : soirée choisie sur le téléphone qui a scanné le QR code
  useEffect(() => {
    if (!pair) return;
    const t = setInterval(async () => {
      if (document.hidden) return;
      try {
        const d = await (await fetch(`/api/jukebox/tv?id=${pair}`, { cache: "no-store" })).json();
        if (d.code) {
          if (d.token) setAdminToken(d.code, d.token); // mode son : la télé devient le lecteur de la régie
          open(d.code, !!d.token, true); // choix fait sur le téléphone : la télé prend le son
        }
      } catch (e) { /* réseau : on retentera */ }
    }, 2000);
    return () => clearInterval(t);
  }, [pair]); // eslint-disable-line react-hooks/exhaustive-deps

  const open = async (c, sound = false, claim = false) => {
    if (c.length !== 6 || busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/jukebox/${c}`, { cache: "no-store" });
      if (res.status === 404) throw new Error(`Aucune soirée avec le code ${formatCode(c)}.`);
      try { localStorage.setItem(LAST_KEY, c); localStorage.setItem(SOUND_KEY, sound ? "1" : ""); } catch (e) { /* stockage indisponible */ }
      router.push(`/jukebox/${c}/ecran${sound ? `?son=1${claim ? "&claim=1" : ""}` : ""}`);
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
      <div className="w-full max-w-6xl grid gap-10 md:grid-cols-2 items-center">
        <div className="text-center md:text-left space-y-5">
          <h1 className="text-5xl font-black">🎶 Jukebox sur la télé</h1>
          {pair && origin && (
            <div className="flex flex-col items-center md:items-start gap-4">
              <div className="bg-white p-4 rounded-3xl shrink-0">
                <QRCodeSVG value={`${origin}/tv/${pair}`} size={512} style={{ width: "min(26vw, 42vh)", height: "min(26vw, 42vh)", minWidth: 220, minHeight: 220 }} />
              </div>
              <div className="text-center md:text-left space-y-2">
                <p className="text-2xl text-white/90">Scannez avec la télécommande Jukebox du téléphone (📺 Connecter une télé), ou l'appareil photo.</p>
                <p className="text-lg text-white/60">Code télé : <span className="font-mono font-bold text-white tracking-widest">{pair.toUpperCase().replace(/(.{4})(?=.)/g, "$1 ")}</span></p>
              </div>
            </div>
          )}
          <p className="text-xl text-white/70">Ou saisissez le code de la soirée, affiché dans la régie :</p>
          <p className="font-mono text-6xl font-black tracking-[0.25em]">
            {digits.slice(0, 3)} {digits.slice(3)}
          </p>
          {error && <p className="text-2xl text-amber-300">{error}</p>}
          {busy && <p className="text-2xl text-white/70">Ouverture…</p>}
          {last && !code && (
            <button onClick={() => {
              let sound = false;
              try { sound = localStorage.getItem(SOUND_KEY) === "1" && !!getAdminToken(last); } catch (e) { /* stockage indisponible */ }
              open(last, sound);
            }}
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
