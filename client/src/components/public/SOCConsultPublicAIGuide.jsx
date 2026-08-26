import {
  ArrowLeft,
  Bot,
  GraduationCap,
  RotateCcw,
  Send,
  ShieldCheck,
  Sparkles,
  UserRoundCheck,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "../../api/apiClient";

const SUGGESTIONS = [
  "What is SOCConsult?",
  "How do I book a consultation?",
  "Which role should I choose?",
  "How do I get started?",
];

const QUICK_GUIDE = [
  [GraduationCap, "Student", "Book and manage consultations"],
  [UserRoundCheck, "Faculty", "Manage availability and requests"],
  [ShieldCheck, "Administrator", "Monitor operations and reports"],
];

const WELCOME = {
  role: "assistant",
  content:
    "Hi! I can help you learn about SOCConsult and guide you through using the website. What would you like to know?",
  welcome: true,
};

export default function SOCConsultPublicAIGuide() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([WELCOME]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [showHint, setShowHint] = useState(
    () => sessionStorage.getItem("socconsult_public_ai_seen") !== "true",
  );
  const endRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const desktop = window.matchMedia("(min-width: 768px)");
    const previousOverflow = document.body.style.overflow;
    const syncScrollLock = () => {
      document.body.style.overflow = desktop.matches
        ? previousOverflow
        : "hidden";
    };
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    syncScrollLock();
    desktop.addEventListener("change", syncScrollLock);
    document.addEventListener("keydown", closeOnEscape);
    if (desktop.matches) inputRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      desktop.removeEventListener("change", syncScrollLock);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  useEffect(() => {
    if (open) endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading, open]);

  const toggle = () => {
    setOpen((value) => !value);
    setShowHint(false);
    sessionStorage.setItem("socconsult_public_ai_seen", "true");
  };

  const clearConversation = () => {
    setMessages([WELCOME]);
    setDraft("");
  };

  const send = async (suggestedMessage) => {
    const content = String(suggestedMessage ?? draft).trim();
    if (!content || loading || content.length > 1500) return;
    const history = messages
      .filter((item) => !item.welcome && !item.error)
      .slice(-8)
      .map(({ role, content: historyContent }) => ({
        role,
        content: historyContent,
      }));

    setMessages((current) => [...current, { role: "user", content }]);
    setDraft("");
    setLoading(true);
    try {
      const data = await api("/public/ai/chat", {
        method: "POST",
        body: JSON.stringify({ message: content, history }),
      });
      setMessages((current) => [
        ...current,
        { role: "assistant", content: data.answer },
      ]);
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content:
            error.message ||
            "SOCConsult AI Guide is temporarily unavailable. Please try again.",
          error: true,
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const onKeyDown = (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  };

  return (
    <div className="fixed bottom-[calc(0.875rem+env(safe-area-inset-bottom))] right-0 z-[100] md:bottom-[calc(1.5rem+env(safe-area-inset-bottom))] md:right-6">
      {open && (
        <section
          role="dialog"
          aria-modal="false"
          aria-label="SOCConsult AI Guide"
          className="fixed inset-0 z-[100] flex h-[100dvh] w-full min-w-0 flex-col overflow-hidden bg-white md:inset-auto md:bottom-[calc(6rem+env(safe-area-inset-bottom))] md:right-6 md:h-[min(540px,calc(100dvh-7.5rem))] md:w-[380px] md:rounded-2xl md:border md:border-gold-300 md:shadow-2xl"
        >
          <header className="flex shrink-0 items-center gap-2 border-b border-maroon-700 bg-maroon-800 px-3 pb-3 pt-[calc(0.75rem+env(safe-area-inset-top))] text-white md:gap-3 md:px-4 md:py-3">
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close SOCConsult AI Guide"
              className="grid h-10 w-10 shrink-0 place-items-center rounded-lg text-gold-100 transition hover:bg-maroon-700 hover:text-white focus-visible:ring-2 focus-visible:ring-gold-300 md:hidden"
            >
              <ArrowLeft size={21} />
            </button>
            <span className="hidden h-10 w-10 shrink-0 place-items-center rounded-xl border border-gold-400/70 bg-maroon-900 md:grid">
              <Sparkles size={20} aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-sm font-bold">
                SOCConsult AI Guide
              </h2>
              <p className="truncate text-[11px] font-medium text-gold-100">
                Website Help &amp; Instructions
              </p>
            </div>
            <button
              type="button"
              onClick={clearConversation}
              aria-label="Clear conversation"
              title="Clear conversation"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-gold-100 transition hover:bg-maroon-700 hover:text-white focus-visible:ring-2 focus-visible:ring-gold-300"
            >
              <RotateCcw size={17} />
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close SOCConsult AI Guide"
              className="hidden h-9 w-9 shrink-0 place-items-center rounded-lg text-gold-100 transition hover:bg-maroon-700 hover:text-white focus-visible:ring-2 focus-visible:ring-gold-300 md:grid"
            >
              <X size={19} />
            </button>
          </header>

          <div
            className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-slate-50 p-3 sm:p-4"
            aria-live="polite"
          >
            {messages.map((item, index) => (
              <div key={`${item.role}-${index}`}>
                <div
                  className={`max-w-[88%] whitespace-pre-wrap break-words [overflow-wrap:anywhere] rounded-2xl px-3.5 py-3 text-sm leading-5 shadow-sm ${
                    item.role === "user"
                      ? "ml-auto rounded-br-md bg-maroon-100 text-maroon-950"
                      : item.error
                        ? "mr-auto rounded-bl-md border border-red-200 bg-red-50 text-red-800"
                        : "mr-auto rounded-bl-md border border-slate-200 bg-white text-slate-700"
                  }`}
                >
                  {item.welcome && (
                    <div className="mb-2 flex items-center gap-2 font-bold text-maroon-900">
                      <Bot size={16} className="text-gold-600" />
                      SOCConsult AI Guide
                    </div>
                  )}
                  {item.content}
                </div>

                {item.welcome && (
                  <div className="mt-3 space-y-3">
                    <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                      <p className="text-[11px] font-extrabold uppercase tracking-wider text-maroon-800">
                        Quick Guide
                      </p>
                      <div className="mt-2 grid gap-2">
                        {QUICK_GUIDE.map(([Icon, role, text]) => (
                          <div
                            key={role}
                            className="flex min-w-0 items-center gap-2.5 text-xs"
                          >
                            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-maroon-50 text-maroon-800">
                              <Icon size={14} />
                            </span>
                            <p className="min-w-0 text-slate-600">
                              <span className="font-bold text-slate-800">
                                {role}:
                              </span>{" "}
                              {text}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {SUGGESTIONS.map((suggestion) => (
                        <button
                          key={suggestion}
                          type="button"
                          onClick={() => send(suggestion)}
                          disabled={loading}
                          className="rounded-full border border-maroon-200 bg-white px-3 py-2 text-left text-xs font-semibold leading-4 text-maroon-800 transition hover:border-maroon-400 hover:bg-maroon-50 focus-visible:ring-2 focus-visible:ring-maroon-200 disabled:opacity-50"
                        >
                          {suggestion}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
            {loading && (
              <div className="mr-auto flex max-w-[88%] items-center gap-2 rounded-2xl rounded-bl-md border border-slate-200 bg-white px-3.5 py-3 text-sm text-slate-600 shadow-sm">
                <span className="h-2 w-2 animate-pulse rounded-full bg-gold-500" />
                Preparing an answer...
              </div>
            )}
            <div ref={endRef} />
          </div>

          <div className="shrink-0 border-t border-slate-200 bg-white p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] md:p-3">
            <div className="flex min-w-0 items-end gap-2">
              <textarea
                ref={inputRef}
                value={draft}
                onChange={(event) =>
                  setDraft(event.target.value.slice(0, 1500))
                }
                onKeyDown={onKeyDown}
                disabled={loading}
                rows={2}
                maxLength={1500}
                placeholder="Ask about SOCConsult..."
                aria-label="Ask about SOCConsult"
                className="min-h-[44px] min-w-0 flex-1 resize-none rounded-xl border border-slate-300 px-3 py-2 text-sm leading-5 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-maroon-500 focus:ring-2 focus:ring-maroon-100 disabled:bg-slate-100"
              />
              <button
                type="button"
                onClick={() => send()}
                disabled={!draft.trim() || loading}
                aria-label="Send message"
                className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-maroon-800 text-white shadow-sm transition hover:bg-maroon-900 focus-visible:ring-2 focus-visible:ring-maroon-300 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Send size={18} />
              </button>
            </div>
            <p className="mt-2 text-center text-[10px] leading-4 text-slate-500">
              Public website guidance only. No account or database access.
            </p>
          </div>
        </section>
      )}

      <div
        className={`group relative items-center gap-2 ${open ? "hidden md:flex" : "flex"}`}
      >
        {showHint && !open && (
          <span className="hidden rounded-full border border-gold-300 bg-white px-3 py-2 text-xs font-bold text-maroon-800 shadow-md md:inline-flex">
            Need help?
          </span>
        )}
        <span className="pointer-events-none absolute bottom-full right-0 mb-2 hidden whitespace-nowrap rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 md:block">
          Need help? Ask SOCConsult AI
        </span>
        <button
          type="button"
          onClick={toggle}
          aria-label="Open SOCConsult AI Guide"
          title="SOCConsult AI Guide"
          aria-expanded={open}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-gold-400/90 bg-maroon-800 text-white shadow-md transition-colors duration-150 hover:bg-maroon-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-300 focus-visible:ring-offset-2 md:hidden"
        >
          <span
            aria-hidden="true"
            className="text-sm font-bold tracking-wide"
          >
            SC
          </span>
        </button>
        <button
          type="button"
          onClick={toggle}
          aria-label={
            open ? "Close SOCConsult AI Guide" : "Open SOCConsult AI Guide"
          }
          title="SOCConsult AI Guide"
          aria-expanded={open}
          className="hidden h-12 w-12 shrink-0 place-items-center rounded-full border-2 border-gold-400 bg-maroon-800 text-white shadow-md transition-colors duration-150 hover:bg-maroon-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-300 focus-visible:ring-offset-2 md:grid"
        >
          {open ? (
            <X size={20} aria-hidden="true" />
          ) : (
            <span
              aria-hidden="true"
              className="text-sm font-bold tracking-wide"
            >
              SC
            </span>
          )}
        </button>
      </div>
    </div>
  );
}
