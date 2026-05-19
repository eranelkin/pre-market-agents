"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/", label: "Home" },
  { href: "/models", label: "Models" },
];

export function NavBar() {
  const pathname = usePathname();

  return (
    <header className="border-b border-border bg-background sticky top-0 z-50">
      <nav className="max-w-7xl mx-auto px-6 h-12 flex items-center gap-1">
        <span className="font-bold text-sm tracking-tight text-foreground mr-4">
          Pre-Market Advisor
        </span>
        {links.map(({ href, label }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={`px-3 py-1.5 text-sm rounded transition-colors ${
                active
                  ? "bg-accent text-foreground font-medium"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent"
              }`}
            >
              {label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
