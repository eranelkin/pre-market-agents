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
    <html lang="en" className="dark">
      <body className={inter.className}>
        <header className="border-b border-border bg-background sticky top-0 z-50">
          <nav className="max-w-7xl mx-auto px-6 h-12 flex items-center gap-1">
            <span className="font-bold text-sm tracking-tight text-foreground mr-4">
              Pre-Market Advisor
            </span>
            <Link href="/" className="px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:bg-accent rounded transition-colors">
              Home
            </Link>
            <Link href="/models" className="px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground hover:bg-accent rounded transition-colors">
              Models
            </Link>
          </nav>
        </header>
        {children}
      </body>
    </html>
  );
}
