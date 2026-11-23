import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import { PwaRegister } from "../components/pwa-register";
import "./globals.css";

export const viewport: Viewport = {
  initialScale: 1,
  themeColor: "#0076a8",
  width: "device-width",
};

export const metadata: Metadata = {
  applicationName: "superRestaurant",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "superRestaurant",
  },
  description: "Sistema POS para restaurantes multi-sucursal.",
  icons: {
    apple: [{ sizes: "180x180", type: "image/png", url: "/icons/apple-touch-icon.png" }],
    icon: [
      { type: "image/svg+xml", url: "/icons/icon.svg" },
      { sizes: "192x192", type: "image/png", url: "/icons/icon-192.png" },
      { sizes: "512x512", type: "image/png", url: "/icons/icon-512.png" },
    ],
  },
  manifest: "/manifest.webmanifest",
  title: "superRestaurant",
};

export default function RootLayout({ children }: { readonly children: ReactNode }): ReactNode {
  return (
    <html lang="es">
      <body className="font-sans antialiased">
        {children}
        <PwaRegister />
      </body>
    </html>
  );
}
