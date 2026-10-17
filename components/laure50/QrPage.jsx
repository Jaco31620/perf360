"use client";
/* QR code à afficher/imprimer : ouvre la page des paroles (/laure50) sur les téléphones. */
import { useEffect, useState } from "react";
import { QRCodeCanvas } from "qrcode.react";
import Backdrop from "./Backdrop";

export default function QrPage() {
  const [url, setUrl] = useState("");
  useEffect(() => setUrl(`${window.location.origin}/laure50`), []);
  return (
    <Backdrop>
      <div className="l50-center">
        <img className="l50-logo-qr" src="/laure50/logo.png" alt="Laure 1976" />
        {url && (
          <div className="l50-qr">
            <QRCodeCanvas value={url} size={300} marginSize={2} fgColor="#1a0d05" bgColor="#f4e7c7" />
          </div>
        )}
        <p className="l50-url">{url.replace(/^https?:\/\//, "")}</p>
        <p className="l50-subtitle">Scannez pour chanter avec les paroles</p>
      </div>
    </Backdrop>
  );
}
