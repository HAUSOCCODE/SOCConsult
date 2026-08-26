import {
  ArrowLeft,
  Bot,
  RotateCcw,
  Send,
  Sparkles,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "../../api/apiClient";

const ADMIN_SUGGESTIONS = [
  "How many students are registered?",
  "How many faculty are registered?",
  "Summarize this month's consultations.",
  "Show appointment status counts.",
];

export default function SOCConsultAIAssistant({
  endpoint = "/admin/ai/chat",
  title = "SOCConsult AI Assistant",
  subtitle = "Administrative Reporting Assistant",
  welcome = "Ask questions about SOCConsult users, faculty, appointments, consultations, and administrative statistics.",
  suggestions = ADMIN_SUGGESTIONS,
  placeholder = "Ask about SOCConsult statistics...",
  disclaimer = "Read-only administrative reporting from current SOCConsult data.",
  loadingLabel = "Analyzing SOCConsult data...",
  launcherMonogram = "A",
}) {
  const WELCOME = { role: "assistant", content: welcome, welcome: true };
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([WELCOME]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const endRef = useRef(null);
  const inputRef = useRef(null);
  const submittingRef = useRef(false);

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
    if (desktop.matches) setTimeout(() => inputRef.current?.focus(), 0);
    return () => {
      document.body.style.overflow = previousOverflow;
      desktop.removeEventListener("change", syncScrollLock);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  useEffect(() => {
    if (open) endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading, open]);

  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const timer = window.setInterval(
      () => setCooldown((current) => Math.max(0, current - 1)),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [cooldown]);

  const clearConversation = () => {
    setMessages([WELCOME]);
    setDraft("");
  };

  const send = async (suggestedMessage) => {
    const content = String(suggestedMessage ?? draft).trim();
    if (
      !content ||
      loading ||
      submittingRef.current ||
      cooldown > 0 ||
      content.length > 2000
    )
      return;

    const history = messages
      .filter((item) => !item.welcome && !item.error)
      .slice(-6)
      .map(({ role, content: historyContent }) => ({
        role,
        content: historyContent,
      }));
    setMessages((current) => [...current, { role: "user", content }]);
    setDraft("");
    submittingRef.current = true;
    setLoading(true);
    try {
      const data = await api(endpoint, {
        method: "POST",
        body: JSON.stringify({ message: content, history }),
      });
      setMessages((current) => [
        ...current,
        { role: "assistant", content: data.answer },
      ]);
    } catch (error) {
      const retryAfter = Number(error.retryAfter) || 0;
      if (retryAfter > 0) setCooldown(retryAfter);
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content: `${
            error.message ||
            "SOCConsult AI Assistant is temporarily unavailable. Please try again."
          }${retryAfter > 0 ? ` Please wait ${retryAfter} seconds before trying again.` : ""}`,
          error: true,
        },
      ]);
    } finally {
      submittingRef.current = false;
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
          aria-label={title}
          className="fixed inset-0 z-[100] flex h-[100dvh] w-full min-w-0 flex-col overflow-hidden bg-white md:inset-auto md:bottom-[calc(6rem+env(safe-area-inset-bottom))] md:right-6 md:h-[min(560px,calc(100dvh-7.5rem))] md:w-[380px] md:rounded-2xl md:border md:border-gold-300 md:shadow-2xl"
        >
          <header className="flex shrink-0 items-center gap-2 border-b border-maroon-700 bg-maroon-800 px-3 pb-3 pt-[calc(0.75rem+env(safe-area-inset-top))] text-white md:gap-3 md:px-4 md:py-3">
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label={`Close ${title}`}
              className="grid h-10 w-10 shrink-0 place-items-center rounded-lg text-gold-100 transition hover:bg-maroon-700 hover:text-white focus-visible:ring-2 focus-visible:ring-gold-300 md:hidden"
            >
              <ArrowLeft size={21} />
            </button>
            <span className="hidden h-10 w-10 shrink-0 place-items-center rounded-xl border border-gold-400/70 bg-maroon-900 md:grid">
              <Bot size={21} aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-sm font-bold">
                {title}
              </h2>
              <p className="truncate text-[11px] font-medium text-gold-100">
                {subtitle}
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
              aria-label={`Close ${title}`}
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
                      <Sparkles size={16} className="text-gold-600" />
                      {title}
                    </div>
                  )}
                  {item.content}
                </div>
                {item.welcome && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {suggestions.map((suggestion) => (
                      <button
                        key={suggestion}
                        type="button"
                        onClick={() => send(suggestion)}
                        disabled={loading || cooldown > 0}
                        className="rounded-full border border-maroon-200 bg-white px-3 py-2 text-left text-xs font-semibold leading-4 text-maroon-800 transition hover:border-maroon-400 hover:bg-maroon-50 disabled:opacity-50"
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {loading && (
              <div className="mr-auto flex max-w-[88%] items-center gap-2 rounded-2xl rounded-bl-md border border-slate-200 bg-white px-3.5 py-3 text-sm text-slate-600 shadow-sm">
                <span className="h-2 w-2 animate-pulse rounded-full bg-gold-500" />
                {loadingLabel}
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
                  setDraft(event.target.value.slice(0, 2000))
                }
                onKeyDown={onKeyDown}
                disabled={loading || cooldown > 0}
                rows={2}
                maxLength={2000}
                placeholder={placeholder}
                aria-label={placeholder}
                className="min-h-[44px] min-w-0 flex-1 resize-none rounded-xl border border-slate-300 px-3 py-2 text-sm leading-5 text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-maroon-500 focus:ring-2 focus:ring-maroon-100 disabled:bg-slate-100"
              />
              <button
                type="button"
                onClick={() => send()}
                disabled={!draft.trim() || loading || cooldown > 0}
                aria-label="Send message"
                className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-maroon-800 text-white shadow-sm transition hover:bg-maroon-900 focus-visible:ring-2 focus-visible:ring-maroon-300 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Send size={18} />
              </button>
            </div>
            {cooldown > 0 && (
              <p className="mt-2 text-center text-xs font-semibold text-amber-700">
                Please wait {cooldown} second{cooldown === 1 ? "" : "s"} before
                sending another request.
              </p>
            )}
            <p className="mt-2 text-center text-[10px] leading-4 text-slate-500">
              {disclaimer}
            </p>
          </div>
        </section>
      )}

      <div className={`group relative ${open ? "hidden md:block" : "block"}`}>
        <span className="pointer-events-none absolute bottom-full right-0 mb-2 hidden whitespace-nowrap rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs font-medium text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 md:block">
          {title}
        </span>
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={`Open ${title}`}
          title={title}
          aria-expanded={open}
          className="grid h-10 w-9 place-items-center rounded-l-xl border border-r-0 border-gold-400/90 bg-maroon-800 text-white shadow-[-3px_3px_10px_rgba(45,15,20,0.2)] transition hover:w-10 hover:bg-maroon-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-300 focus-visible:ring-offset-2 md:hidden"
        >
          <span
            aria-hidden="true"
            className="text-base font-bold leading-none"
          >
            {launcherMonogram}
          </span>
        </button>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-label={
            open
              ? `Close ${title}`
              : `Open ${title}`
          }
          title={title}
          aria-expanded={open}
          className="hidden h-14 w-14 place-items-center rounded-full border-2 border-gold-400 bg-maroon-800 text-white shadow-lg transition hover:-translate-y-0.5 hover:bg-maroon-900 hover:shadow-xl focus-visible:ring-4 focus-visible:ring-gold-200 md:grid"
        >
          {open ? (
            <X size={22} aria-hidden="true" />
          ) : (
            <span
              aria-hidden="true"
              className="text-base font-bold leading-none"
            >
              {launcherMonogram}
            </span>
          )}
        </button>
      </div>
    </div>
  );
}
