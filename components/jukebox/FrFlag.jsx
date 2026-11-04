/* Petit drapeau bleu-blanc-rouge (l'émoji 🇫🇷 s'affiche « FR » sous Windows). */
export function FrFlag({ className = "" }) {
  return (
    <span aria-label="France" role="img" className={`inline-flex align-[-0.1em] w-[1.15em] h-[0.8em] rounded-[2px] overflow-hidden ring-1 ring-black/10 ${className}`}>
      <span className="flex-1 bg-[#0055A4]" /><span className="flex-1 bg-white" /><span className="flex-1 bg-[#EF4135]" />
    </span>
  );
}
