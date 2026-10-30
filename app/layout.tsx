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
import "./labels.css";

export const metadata: Metadata = {
  title: "Gastro-Garage · Catering",
  description: "Magyar–román catering munkafelület.",
  icons: {
    icon: [{ url: "/favicon-32.png", sizes: "32x32", type: "image/png" }, { url: "/logo-192.png", sizes: "192x192", type: "image/png" }],
    shortcut: "/favicon-32.png",
    apple: "/apple-touch-icon.png",
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
