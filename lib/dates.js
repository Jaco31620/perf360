/* Dates au format des champs <input type="date"> (AAAA-MM-JJ), client et serveur. */
export const todayInput = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/* « 2026-11-15 » → « samedi 15 novembre 2026 » (autre texte : renvoyé tel quel). */
export function fmtDateFr(v) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v || ""))) return v || "";
  const [y, m, d] = v.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}
