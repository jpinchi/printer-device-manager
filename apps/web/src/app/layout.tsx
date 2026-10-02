import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { Inter } from "next/font/google";
import "./globals.css";
import { AppShell } from "@/components/AppShell";
import { ScrollToTop } from "@/components/ScrollToTop";
import { I18nProvider } from "@/lib/i18n";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  title: "Printer Device Manager",
  description:
    "Descubrimiento y monitoreo SNMP de impresoras de red (clon de RICOH Device Manager NX Lite).",
  applicationName: "Printer Device Manager",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
    apple: [{ url: "/icon.svg" }],
    shortcut: ["/icon.svg"],
  },
  appleWebApp: {
    capable: true,
    title: "PDM",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  themeColor: "#0b1120",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es" className={inter.variable} suppressHydrationWarning>
      <body className="min-h-screen bg-bg font-sans text-slate-100 antialiased">
        {/* Aplica el tema guardado ANTES de pintar (evita parpadeo). */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var t=localStorage.getItem('pdm.theme');document.documentElement.setAttribute('data-theme',t==='light'?'light':'dark');}catch(e){document.documentElement.setAttribute('data-theme','dark');}})();",
          }}
        />
        <I18nProvider>
          <Suspense fallback={null}>
            <ScrollToTop />
          </Suspense>
          <AppShell>{children}</AppShell>
        </I18nProvider>
      </body>
    </html>
  );
}
