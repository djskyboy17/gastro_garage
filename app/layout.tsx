import type { Metadata } from "next";
import "./globals.css";
import './operations.css';

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
