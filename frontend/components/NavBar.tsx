"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Settings, Database, Download, Upload, ChevronRight } from "lucide-react";

const links = [
  { href: "/", label: "Home" },
  { href: "/models", label: "Models" },
  { href: "/prompts", label: "Prompts" },
  { href: "/audit", label: "Audit" },
];

export function NavBar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [dbOpen, setDbOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
        setDbOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <header className="border-b border-border bg-background sticky top-0 z-50">
      <nav
        className="max-w-7xl mx-auto h-12 flex items-center gap-1"
        style={{ maxWidth: "77%" }}
      >
        <span className="font-bold text-sm tracking-tight text-foreground mr-4">
          Pre-Market Advisor
        </span>

        {links.map(({ href, label }) => {
          const active =
            href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className="px-3 py-1.5 text-sm rounded transition-colors"
              style={{
                color: active ? "#60a5fa" : "#D7DFE7",
                backgroundColor: active
                  ? "rgba(96, 165, 250, 0.12)"
                  : "transparent",
                fontWeight: active ? 500 : 400,
              }}
            >
              {label}
            </Link>
          );
        })}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Settings gear */}
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => { setOpen((v) => !v); setDbOpen(false); }}
            className="w-8 h-8 flex items-center justify-center rounded hover:bg-[#2C2D33] transition-colors"
            style={{ color: open ? "#60a5fa" : "#D7DFE7" }}
            title="Settings"
          >
            <Settings size={16} />
          </button>

          {open && (
            <div className="absolute right-1/2 translate-x-1/2 top-full mt-2 w-36 rounded-lg border border-[#4a4b52] bg-[#3C3D45] shadow-2xl py-1 z-50">
              {/* Database item with submenu */}
              <div
                className="relative"
                onMouseEnter={() => setDbOpen(true)}
                onMouseLeave={() => setDbOpen(false)}
              >
                <button className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-[#D7DFE7] hover:bg-[#44454e] transition-colors rounded-sm">
                  <Database size={14} className="text-blue-400" />
                  <span>Database</span>
                  <ChevronRight size={12} className="ml-auto opacity-50" />
                </button>

                {dbOpen && (
                  <div className="absolute left-full top-0 -mt-1 ml-1 w-32 rounded-lg border border-[#4a4b52] bg-[#3C3D45] shadow-2xl py-1 z-50">
                    <button
                      onClick={() => { setOpen(false); setDbOpen(false); }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-[#D7DFE7] hover:bg-[#44454e] transition-colors rounded-sm"
                    >
                      <Download size={14} className="text-emerald-400" />
                      Export
                    </button>
                    <button
                      onClick={() => { setOpen(false); setDbOpen(false); }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-[#D7DFE7] hover:bg-[#44454e] transition-colors rounded-sm"
                    >
                      <Upload size={14} className="text-amber-400" />
                      Import
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </nav>
    </header>
  );
}
