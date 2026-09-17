import type { Metadata, Viewport } from "next";
import { Geist, Newsreader } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";
import { brand } from "@/lib/brand";

const sans = Geist({ variable: "--font-geist-sans", subsets: ["latin"], display: "swap" });
const display = Newsreader({ variable: "--font-newsreader", subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  title: { default: brand.name, template: `%s · ${brand.name}` },
  description: brand.description,
  applicationName: brand.name,
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: brand.name, statusBarStyle: "black-translucent" },
};
export const viewport: Viewport = { themeColor: "#111211", colorScheme: "light" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${sans.variable} ${display.variable}`}>
      <body>
        <a href="#main-content" className="fixed left-3 top-3 z-[100] -translate-y-24 rounded-md bg-ink px-4 py-3 text-sm font-semibold text-ivory focus:translate-y-0">Skip to main content</a>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
