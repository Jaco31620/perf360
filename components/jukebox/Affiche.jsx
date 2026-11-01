"use client";
/*
 * Jukebox — affiche A4 à imprimer pour les invités : nom de la soirée (et
 * logo), gros QR code, adresse et code, 3 étapes. Couleurs de l'ambiance de
 * la soirée ; le bouton « Imprimer » n'apparaît pas à l'impression.
 */
import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { formatCode } from "./storage";
import { themeVars } from "@/lib/jukebox";

export default function Affiche({ code }) {
  const [data, setData] = useState(null);
  const [missing, setMissing] = useState(false);
  const [origin, setOrigin] = useState("");
  useEffect(() => {
    setOrigin(window.location.origin);
    fetch(`/api/jukebox/${code}`, { cache: "no-store" })
      .then((r) => { if (r.status === 404) setMissing(true); return r.ok ? r.json() : null; })
      .then((d) => d && setData(d)).catch(() => setMissing(true));
  }, [code]);

  if (missing) return <p className="p-10 text-center text-gray-600">La soirée {formatCode(code)} n'existe pas (ou plus).</p>;
  if (!data || !origin) return <p className="p-10 text-center text-gray-400">Chargement…</p>;
  const { session } = data;
  const theme = session.theme;
  const url = `${origin}/jukebox/${code}`;
  const host = origin.replace(/^https?:\/\//, "");

  return (
    <div className="min-h-screen bg-gray-100 print:bg-white py-6 print:py-0" style={themeVars(theme)}>
      <style>{"@page { size: A4; margin: 0; } @media print { html, body { background: #fff; } } .jb-affiche, .jb-affiche * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }"}</style>
      <div className="max-w-[210mm] mx-auto mb-4 flex justify-center gap-3 print:hidden">
        <button onClick={() => window.print()} className="bg-gray-900 text-white font-bold px-6 py-2.5 rounded-full">🖨️ Imprimer</button>
        <p className="self-center text-sm text-gray-500">Format A4, à afficher près du bar ou de l'entrée.</p>
      </div>
      <div className="jb-affiche mx-auto bg-white shadow-xl print:shadow-none w-[210mm] min-h-[297mm] print:h-[297mm] overflow-hidden flex flex-col items-center text-center px-[18mm] py-[16mm]">
        {theme?.logo && <img src={`/api/jukebox/${code}/logo?v=${theme.logo}`} alt="" className="h-[22mm] max-w-[80mm] object-contain mb-[6mm]" />}
        <p className={`${(theme?.title || session.name).length > 40 ? "text-[10pt] tracking-[0.12em]" : "text-[13pt] tracking-[0.25em]"} font-bold uppercase text-gray-500 line-clamp-2`}>{theme?.title || session.name}</p>
        <h1 className="mt-[4mm] text-[38pt] leading-[1.05] font-black text-gray-900">C'est vous qui choisissez la musique&nbsp;! 🎶</h1>
        <div className="mt-[10mm] p-[5mm] rounded-[8mm] border-[3mm]" style={{ borderColor: "var(--jb-accent)" }}>
          <QRCodeSVG value={url} size={340} level="M" style={{ width: "95mm", height: "95mm" }} />
        </div>
        <p className="mt-[6mm] text-[16pt] font-bold text-gray-900">{url.replace(/^https?:\/\//, "")}</p>
        <p className="text-[13pt] text-gray-600">ou code <b className="font-mono text-[20pt] tracking-widest text-gray-900">{formatCode(code)}</b> sur {host}/jukebox</p>
        <ol className="mt-[12mm] grid grid-cols-3 gap-[6mm] w-full text-left">
          {[["📷", "Scannez le QR code", "avec l'appareil photo de votre téléphone"],
            ["✍️", "Votre prénom", "pour que tout le monde sache qui a choisi"],
            ["🔎", "Cherchez un titre", "et ajoutez-le : il passera bientôt !"]].map(([icon, title, text], i) => (
            <li key={i} className="rounded-[5mm] p-[5mm]" style={{ background: "var(--jb-soft)" }}>
              <p className="text-[22pt]">{icon}</p>
              <p className="mt-[2mm] text-[13pt] font-black text-gray-900">{i + 1}. {title}</p>
              <p className="text-[10.5pt] text-gray-600 leading-snug">{text}</p>
            </li>
          ))}
        </ol>
        <p className="mt-auto pt-[8mm] text-[9pt] text-gray-400">Jukebox · {host}</p>
      </div>
    </div>
  );
}
