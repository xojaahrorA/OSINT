import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "OSINT Radar — Avtomatlashtirilgan ochiq manbalar razvedkasi",
  description:
    "Talabalar uchun o'quv loyihasi: maqsadni kiriting — tizim ochiq internet bo'ylab (ijtimoiy tarmoqlar, forumlar, hujjatlar, texnik manbalar) to'liq avtomatik skanerlaydi va AI xulosa chiqaradi.",
  keywords: [
    "OSINT",
    "ochiq manbalar razvedkasi",
    "avtomatlashtirish",
    "talim",
    "xavfsizlik",
    "AI tahlil",
  ],
  authors: [{ name: "OSINT Radar" }],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="uz" className="dark" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground min-h-screen flex flex-col`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
