"use client";
/*
 * Champ mot de passe avec un œil pour l'afficher en clair (ou le masquer).
 * Les autres props (value, onChange, placeholder, autoFocus…) sont transmises
 * à l'input ; `className` et `style` s'appliquent à l'input (pleine largeur,
 * marge à droite réservée à l'icône).
 */
import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";

export default function PasswordInput({ className = "", style, autoComplete = "current-password", ...props }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <input {...props} type={visible ? "text" : "password"} autoComplete={autoComplete} className={className}
        style={{ width: "100%", boxSizing: "border-box", ...style, paddingRight: 44 }} />
      <button type="button" onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Masquer le mot de passe" : "Afficher le mot de passe"} title={visible ? "Masquer" : "Afficher"}
        className="pw-eye absolute inset-y-0 right-0 flex items-center px-3.5 text-gray-400 hover:text-gray-700">
        {visible ? <EyeOff size={20} /> : <Eye size={20} />}
      </button>
    </div>
  );
}
