/*
 * Ancienne URL du dispositif. Conservée pour les liens/QR existants :
 * elle redirige vers l'instance par défaut (campagne « ffbb-blackroll »).
 */
import { redirect } from "next/navigation";

export default function FfbbTestRedirect() {
  redirect("/c/ffbb-blackroll");
}
