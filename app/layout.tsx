import type { Metadata } from "next";
import "./globals.css";
import "./operations.css";
import "./purchasing.css";
import "./delivery.css";
import "./access.css";
import "./safety.css";
import "./recurring.css";
import "./portal.css";
import "./menu.css";
import "./stocktake.css";
import "./fulfillment.css";
import "./courier.css";
import "./packing.css";

export const metadata: Metadata = {
  title: "Konyha · Catering műhely",
  description: "Magyar–román catering munkafelület.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="hu">
      <body className="antialiased">{children}</body>
    </html>
  );
}
