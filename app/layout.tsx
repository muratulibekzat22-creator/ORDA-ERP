import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";
import AuthProvider from "@/components/AuthProvider";
import RouteShell from "@/components/layout/RouteShell";
import NetworkStatus from "@/components/NetworkStatus";
import MfaEnrollmentBanner from "@/components/MfaEnrollmentBanner";
import ServiceWorkerRegistration from "@/components/ServiceWorkerRegistration";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ORDA ERP",
  description: "Внутренняя система управления ALTYN SAPA",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  colorScheme: "dark",
  themeColor: "#0B1120",
  interactiveWidget: "resizes-content",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Nonce-based CSP requires request-time rendering so Next.js can apply the
  // request nonce to its framework and hydration scripts.
  await headers();

  return (
    <html
      lang="ru"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-screen bg-slate-950 text-white">
        <AuthProvider>
          <NetworkStatus />
          <MfaEnrollmentBanner />
          <ServiceWorkerRegistration />
          <RouteShell>{children}</RouteShell>
        </AuthProvider>
      </body>
    </html>
  );
}
