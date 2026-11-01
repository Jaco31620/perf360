"use client";
import { useRef, useState } from "react";

/* Sauvegarde de la mémoire : export CSV (toutes les colonnes), import pour
 * restaurer (titres ajoutés ou mis à jour, jamais supprimés). */
const CSV_COLS = ["key", "label", "artist_fix", "title_fix", "video_id", "video_title", "video_channel", "duration", "song_duration",
  "validated", "blind", "lyrics", "missing", "plays", "rank", "year", "fr", "merged_into", "checked_at", "enriched_at", "created_at"];
const csvCell = (v) => (v == null ? "" : /[",\n;]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') quoted = false; else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((x) => x !== "")) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x !== "")) rows.push(row);
  const [head, ...body] = rows;
  return (body || []).map((r) => Object.fromEntries((head || []).map((h, i) => [h.replace(/^\uFEFF/, "").trim(), r[i] ?? ""])));
}
export function Backup({ call, onImported }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const file = useRef(null);
  const exportCsv = async () => {
    setBusy(true);
    try {
      const { rows } = await call("POST", { action: "exportSongs" });
      const csv = "\uFEFF" + [CSV_COLS.join(","), ...rows.map((r) => CSV_COLS.map((c) => csvCell(r[c])).join(","))].join("\n");
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
      a.download = `jukebox-memoire-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000); // après le début du téléchargement
      setMsg(`${rows.length} lignes exportées.`);
    } catch (e) { setMsg(e.message); } finally { setBusy(false); }
  };
  const importCsv = async (f) => {
    if (file.current) file.current.value = ""; // le même fichier pourra être rechoisi
    if (!f) return;
    const rows = parseCsv(await f.text());
    if (!rows.length || !("key" in rows[0]) || !("video_id" in rows[0])) { setMsg("Fichier non reconnu (export de la mémoire attendu)."); return; }
    if (!confirm(`Importer ${rows.length} lignes ?\nLes titres absents sont ajoutés, ceux déjà en mémoire sont remplacés par la version du fichier. Rien n'est supprimé.`)) return;
    setBusy(true);
    try {
      const d = await call("POST", { action: "importSongs", rows });
      setMsg(`${d.imported} lignes importées${d.skipped ? `, ${d.skipped} ignorées (incomplètes)` : ""}.`);
      onImported();
    } catch (e) { setMsg(e.message); } finally { setBusy(false); if (file.current) file.current.value = ""; }
  };
  return (
    <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-gray-100 text-xs">
      <span className="font-bold text-gray-500">💾 Sauvegarde</span>
      <button disabled={busy} onClick={exportCsv} className="font-bold bg-gray-100 px-3 py-1.5 rounded-full disabled:opacity-50">⬇️ Exporter (CSV)</button>
      <button disabled={busy} onClick={() => file.current?.click()} className="font-bold bg-gray-100 px-3 py-1.5 rounded-full disabled:opacity-50">⬆️ Importer</button>
      <input ref={file} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => importCsv(e.target.files?.[0])} />
      {msg && <span className="text-gray-500">{msg}</span>}
    </div>
  );
}
