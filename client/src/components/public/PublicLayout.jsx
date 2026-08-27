import { useState } from "react";
import { Link } from "react-router-dom";
import { ExternalLink, Instagram, Menu, X } from "lucide-react";
import Brand from "../Brand";

const navLinks = [
  ["Home", "/#home"],
  ["About", "/#about"],
  ["Features", "/#features"],
];

export function Navbar() {
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 shadow-sm backdrop-blur-sm">
      <div className="container-page flex h-16 items-center justify-between">
        <Link
          to="/"
          aria-label="SOCConsult home"
          onClick={() => setOpen(false)}
        >
          <Brand />
        </Link>
        <nav
          className="hidden items-center gap-8 text-sm font-semibold text-slate-700 md:flex"
          aria-label="Primary navigation"
        >
          {navLinks.map(([label, href], index) => (
            <a
              key={label}
              className={`relative py-2 transition hover:text-maroon-800 ${index === 0 ? "text-maroon-900 after:absolute after:inset-x-0 after:-bottom-0.5 after:mx-auto after:h-0.5 after:w-7 after:bg-gold-500" : ""}`}
              href={href}
            >
              {label}
            </a>
          ))}
          <Link
            to="/get-started"
            className="btn-primary h-10 !rounded-lg !px-5 !py-2.5"
          >
            Get Started
          </Link>
        </nav>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="grid h-10 w-10 place-items-center rounded-lg text-maroon-800 transition hover:bg-maroon-50 focus-visible:ring-2 focus-visible:ring-maroon-200 md:hidden"
          aria-label={open ? "Close navigation" : "Open navigation"}
          aria-expanded={open}
        >
          {open ? <X size={22} /> : <Menu size={22} />}
        </button>
      </div>
      {open && (
        <nav
          className="container-page border-t border-slate-100 bg-white py-3 shadow-sm md:hidden"
          aria-label="Mobile navigation"
        >
          {navLinks.map(([label, href]) => (
            <a
              key={label}
              className="block rounded-lg px-3 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-maroon-50 hover:text-maroon-800"
              href={href}
              onClick={() => setOpen(false)}
            >
              {label}
            </a>
          ))}
          <Link
            className="btn-primary mt-2 h-10 w-full"
            to="/get-started"
            onClick={() => setOpen(false)}
          >
            Get Started
          </Link>
        </nav>
      )}
    </header>
  );
}

export function Footer() {
  return (
    <footer className="relative overflow-hidden bg-maroon-900 pb-24 pt-10 text-white md:pb-10">
      <div className="pointer-events-none absolute -left-20 -top-24 h-64 w-64 rounded-full border border-maroon-700" />
      <div className="container-page relative">
        <div className="flex min-w-0 flex-col items-center gap-7 text-center sm:flex-row sm:items-start sm:justify-between sm:text-left">
          <div className="min-w-0">
            <Brand light />
            <p className="mt-3 max-w-sm break-words text-sm leading-6 text-maroon-100">
              Faculty–student consultation made organized, accessible, and
              secure.
            </p>
          </div>
          <div className="min-w-0 text-sm sm:text-right">
            <p className="font-semibold text-white">School of Computing</p>
            <p className="text-maroon-100">Holy Angel University</p>
            <div className="mt-3 flex items-center justify-center gap-2 sm:justify-end">
              <a
                href="https://www.facebook.com/haucictofficial"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Visit HAU School of Computing on Facebook"
                className="grid h-8 w-8 place-items-center rounded-full border border-maroon-600 text-maroon-100 transition hover:border-gold-400 hover:text-gold-300"
              >
                <ExternalLink size={14} />
              </a>
              <a
                href="https://www.instagram.com/haucscsoc/"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Visit HAU School of Computing Student Council on Instagram"
                className="grid h-8 w-8 place-items-center rounded-full border border-maroon-600 text-maroon-100 transition hover:border-gold-400 hover:text-gold-300"
              >
                <Instagram size={14} />
              </a>
            </div>
          </div>
        </div>
        <p className="mt-8 border-t border-maroon-700 pt-4 text-center text-xs text-maroon-100">
          © {new Date().getFullYear()} SOCConsult. All rights reserved.
        </p>
      </div>
    </footer>
  );
}
