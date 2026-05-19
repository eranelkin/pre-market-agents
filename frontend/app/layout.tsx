import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Pre-Market Advisor",
  description: "Daily AI-powered pre-market stock analysis",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <header className="border-b bg-background sticky top-0 z-50">
          <nav className="max-w-6xl mx-auto px-6 h-12 flex items-center gap-6">
            <span className="font-semibold text-sm tracking-tight">Pre-Market Advisor</span>
            <Link href="/" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
              Home
            </Link>
            <Link href="/models" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
              Models
            </Link>
          </nav>
        </header>
        {children}
      </body>
    </html>
  );
}
