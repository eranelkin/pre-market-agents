import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { NavBar } from "@/components/NavBar";
import { TestModeProvider } from "@/lib/test-mode-context";
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
        <TestModeProvider>
          <NavBar />
          {children}
        </TestModeProvider>
      </body>
    </html>
  );
}
