/*
 * Ancienne URL de l'admin. Redirige vers l'admin de l'instance par défaut.
 */
import { redirect } from "next/navigation";

export default function FfbbTestAdminRedirect() {
  redirect("/ffbb-blackroll/admin");
}
