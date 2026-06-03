"use client";
/*
 * Éditeur de texte enrichi (WYSIWYG) sans dépendance, pour le corps de l'e-mail
 * de bienvenue. Basé sur contentEditable + document.execCommand (styleWithCSS),
 * ce qui produit du HTML à styles inline — adapté à l'e-mail. Barre d'outils :
 * gras / italique / souligné / lien / couleur, + insertion des variables.
 */
import { useRef, useEffect } from "react";
import { Bold, Italic, Underline, Link as LinkIcon } from "lucide-react";
import { C } from "./shared";

const VARS = ["{prenom}", "{nom}", "{licence}", "{code}", "{email}"];

export default function RichEditor({ value, onChange }) {
  const ref = useRef(null);

  /* Synchronise depuis l'extérieur sans casser le curseur : on n'écrit dans le
     DOM que si l'éditeur n'a pas le focus et que le contenu diffère réellement. */
  useEffect(() => {
    const el = ref.current;
    if (el && document.activeElement !== el && el.innerHTML !== (value || "")) {
      el.innerHTML = value || "";
    }
  });

  const emit = () => onChange(ref.current?.innerHTML || "");

  function exec(cmd, arg) {
    document.execCommand("styleWithCSS", false, true);
    document.execCommand(cmd, false, arg);
    emit();
  }
  function addLink() {
    const url = window.prompt("Adresse du lien :", "https://");
    if (url) exec("createLink", url.trim());
  }
  function insertVar(v) {
    ref.current?.focus();
    document.execCommand("insertText", false, v);
    emit();
  }

  const keep = (e) => e.preventDefault(); // garde la sélection au clic sur la barre
  const tBtn = {
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    width: 32, height: 30, borderRadius: 7, border: `1px solid ${C.line}`,
    background: C.black, color: C.cream, cursor: "pointer", fontSize: 14, fontWeight: 700,
  };
  const chip = {
    padding: "5px 9px", borderRadius: 999, border: `1px solid ${C.line}`,
    background: C.black, color: C.green, cursor: "pointer", fontSize: 12, fontFamily: "monospace",
  };

  return (
    <div style={{ border: `1px solid ${C.line}`, borderRadius: 10, overflow: "hidden" }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, padding: 8, background: C.ink, borderBottom: `1px solid ${C.line}` }}>
        <button type="button" onMouseDown={keep} onClick={() => exec("bold")} style={tBtn} title="Gras"><Bold size={15} /></button>
        <button type="button" onMouseDown={keep} onClick={() => exec("italic")} style={tBtn} title="Italique"><Italic size={15} /></button>
        <button type="button" onMouseDown={keep} onClick={() => exec("underline")} style={tBtn} title="Souligné"><Underline size={15} /></button>
        <button type="button" onMouseDown={keep} onClick={addLink} style={tBtn} title="Insérer un lien"><LinkIcon size={15} /></button>
        <label onMouseDown={keep} style={{ ...tBtn, position: "relative", overflow: "hidden" }} title="Couleur du texte">
          A
          <input type="color" defaultValue="#161614" onChange={(e) => exec("foreColor", e.target.value)}
            style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer" }} />
        </label>
        <span style={{ width: 1, height: 22, background: C.line, margin: "0 2px" }} />
        {VARS.map((v) => (
          <button key={v} type="button" onMouseDown={keep} onClick={() => insertVar(v)} style={chip} title={`Insérer ${v}`}>{v}</button>
        ))}
      </div>
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        onInput={emit}
        style={{
          minHeight: 180, padding: "16px 18px", background: C.cream, color: C.ink,
          fontFamily: "Helvetica, Arial, sans-serif", fontSize: 15, lineHeight: 1.6,
          outline: "none", overflowY: "auto",
        }}
      />
    </div>
  );
}
