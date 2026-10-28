import useDialogFocus from "../../hooks/useDialogFocus";
import { CalendarDays, ChevronLeft, ChevronRight, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { api } from "../../api/apiClient";
import { isRecoverableStudentError, safeStudentError } from "../../utils/studentUiErrors";
import { StatusBadge } from "../../components/UI";
import { formatPersonName } from "../../utils/formatPersonName";

const TIMEZONE = "Asia/Manila";
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const STATUS_STYLES = {
  Available: { dot: "bg-emerald-600", event: "border-emerald-200 bg-emerald-50 text-emerald-900" },
  Pending: { dot: "bg-amber-600", event: "border-amber-200 bg-amber-50 text-amber-900" },
  Inactive: { dot: "bg-slate-500", event: "border-slate-300 bg-slate-100 text-slate-700" },
  Confirmed: {
    dot: "bg-maroon-700",
    event: "border-maroon-200 bg-maroon-50 text-maroon-900",
  },
  "Reschedule Proposed": {
    dot: "bg-amber-600",
    event: "border-amber-200 bg-amber-50 text-amber-900",
  },
  "Awaiting Attendance Update": {
    dot: "bg-orange-600",
    event: "border-orange-200 bg-orange-50 text-orange-900",
  },
  Completed: {
    dot: "bg-green-700",
    event: "border-green-200 bg-green-50 text-green-900",
  },
  "Attendance Review": {
    dot: "bg-rose-600",
    event: "border-rose-200 bg-rose-50 text-rose-900",
  },
};

const dateParts = (value) =>
  Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: TIMEZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(value)
      .filter(({ type }) => type !== "literal")
      .map(({ type, value: part }) => [type, part]),
  );

const manilaDateKey = (value = new Date()) => {
  const { year, month, day } = dateParts(value);
  return `${year}-${month}-${day}`;
};
const dateFromKey = (key) => {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
};
const keyFromDate = (date) => date.toISOString().slice(0, 10);
const addDays = (key, amount) => {
  const date = dateFromKey(key);
  date.setUTCDate(date.getUTCDate() + amount);
  return keyFromDate(date);
};
const monthStart = (key) => `${key.slice(0, 7)}-01`;
const moveMonth = (key, amount) => {
  const date = dateFromKey(monthStart(key));
  date.setUTCMonth(date.getUTCMonth() + amount);
  return keyFromDate(date);
};
const weekStart = (key) => addDays(key, -dateFromKey(key).getUTCDay());
const calendarMonthRange = (key) => {
  const first = monthStart(key);
  const start = addDays(first, -dateFromKey(first).getUTCDay());
  return { start, end: addDays(start, 41) };
};
const calendarWeekRange = (key) => {
  const start = weekStart(key);
  return { start, end: addDays(start, 6) };
};
const dateLabel = (key, options) =>
  new Intl.DateTimeFormat("en-PH", {
    timeZone: "UTC",
    ...options,
  }).format(dateFromKey(key));
const timeLabel = (value) =>
  new Intl.DateTimeFormat("en-PH", {
    timeZone: TIMEZONE,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
const fullDateLabel = (value) =>
  new Intl.DateTimeFormat("en-PH", {
    timeZone: TIMEZONE,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(value));
const range = (count, start) =>
  Array.from({ length: count }, (_, index) => addDays(start, index));
const FINALIZED_STYLES = Object.fromEntries(["Rejected", "Cancelled", "Expired", "No Show"].map(status => [status, STATUS_STYLES.Inactive]));
const eventStyle = (status) => STATUS_STYLES[status] || FINALIZED_STYLES[status] || STATUS_STYLES.Confirmed;
const eventParticipantName = (event) =>
  event.participantName || formatPersonName(event.student?.name);

export default function ConsultationCalendar({
  apiPath = "/faculty/calendar",
  includeAvailability = false,
  consultationsPath = "/faculty/appointments",
  title = "Consultation Calendar",
  description = "View your confirmed and rescheduled faculty-student consultations by date.",
  onEventClick,
  showUpcoming = true,
  emptyMessage,
  personalCalendar = false,
  revision = 0,
}) {
  const today = manilaDateKey();
  const [view, setView] = useState("month");
  const [anchor, setAnchor] = useState(today);
  const [selectedDate, setSelectedDate] = useState(today);
  const [events, setEvents] = useState([]);
  const [upcoming, setUpcoming] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [errorRetryable, setErrorRetryable] = useState(true);
  const [retryKey, setRetryKey] = useState(0);
  const [includeInactive, setIncludeInactive] = useState(true);
  const [includeFinalized, setIncludeFinalized] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [expandedDay, setExpandedDay] = useState(null);
  const requestSequence = useRef(0);
  const period = useMemo(
    () =>
      view === "month" ? calendarMonthRange(anchor) : calendarWeekRange(anchor),
    [anchor, view],
  );

  useEffect(() => {
    const controller = new AbortController();
    const sequence = ++requestSequence.current;
    setLoading(true);
    setError("");
    api(`${apiPath}?start=${period.start}&end=${period.end}${includeAvailability ? "&includeAvailability=true" : ""}${personalCalendar ? `&includeInactive=${includeInactive}&includeFinalized=${includeFinalized}` : ""}`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then((data) => {
        if (controller.signal.aborted || sequence !== requestSequence.current) return;
        setEvents(Array.isArray(data.events) ? data.events : []);
        setUpcoming(Array.isArray(data.upcoming) ? data.upcoming : []);
      })
      .catch((requestError) => {
        if (requestError.name === "AbortError") return;
        if (controller.signal.aborted || sequence !== requestSequence.current) return;
        setEvents([]);
        setUpcoming([]);
        setErrorRetryable(requestError.status === 422 || isRecoverableStudentError(requestError));
        setError(personalCalendar && requestError.status === 422 ? "Too many calendar records. Choose a narrower range using Week view." : safeStudentError(requestError, "We couldn't load the calendar. Please try again."));
      })
      .finally(() => {
        if (!controller.signal.aborted && sequence === requestSequence.current) setLoading(false);
      });
    return () => controller.abort();
  }, [apiPath, includeAvailability, period.end, period.start, retryKey, personalCalendar, includeInactive, includeFinalized, revision]);

  useEffect(() => {
    if (!personalCalendar) return undefined;
    const refresh = () => setRetryKey(value => value + 1);
    window.addEventListener("focus", refresh);
    const timer = window.setInterval(refresh, 60000);
    return () => { window.removeEventListener("focus", refresh); window.clearInterval(timer); };
  }, [personalCalendar]);

  const eventsByDate = useMemo(() => {
    const grouped = new Map();
    for (const event of events) {
      if (!Number.isFinite(+new Date(event.start)) || !Number.isFinite(+new Date(event.end)) || +new Date(event.end) <= +new Date(event.start)) continue;
      let key = manilaDateKey(new Date(event.start));
      const last = personalCalendar ? manilaDateKey(new Date(+new Date(event.end) - 1)) : key;
      if (personalCalendar && key < period.start) key = period.start;
      while (key <= last && (!personalCalendar || key <= period.end)) {
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key).push(event);
        key = addDays(key, 1);
      }
    }
    return grouped;
  }, [events, personalCalendar, period.start, period.end]);

  const navigate = (direction) => {
    const next =
      view === "month"
        ? moveMonth(anchor, direction)
        : addDays(anchor, direction * 7);
    setAnchor(next);
    setSelectedDate(next);
  };
  const goToday = () => {
    setAnchor(today);
    setSelectedDate(today);
  };
  const changeView = (nextView) => {
    setView(nextView);
    setAnchor(selectedDate);
  };
  const chooseDate = (key) => {
    setSelectedDate(key);
    if (view === "month" && key.slice(0, 7) !== anchor.slice(0, 7))
      setAnchor(key);
  };
  const openEvent = useCallback(
    (event, opener) => {
      if (onEventClick) {
        onEventClick(event, opener);
        setExpandedDay(null);
        return;
      }
      setSelectedEvent({ event, opener });
      setExpandedDay(null);
    },
    [onEventClick],
  );

  const heading =
    view === "month"
      ? dateLabel(anchor, { month: "long", year: "numeric" })
      : `${dateLabel(period.start, { month: "short", day: "numeric" })} – ${dateLabel(period.end, { month: "short", day: "numeric", year: "numeric" })}`;

  return (
    <div className="consultation-calendar w-full min-w-0 space-y-5 sm:space-y-6">
      <div>
        <h1 className="break-words text-2xl font-bold tracking-tight text-maroon-900 sm:text-[30px] sm:leading-9">
          {title}
        </h1>
        <p className="mt-2 text-sm leading-6 text-slate-500 sm:text-[15px]">
          {description}
        </p>
      </div>

      {personalCalendar && <div className="flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" checked={includeInactive} onChange={event => setIncludeInactive(event.target.checked)} />Show inactive / unavailable slots</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={includeFinalized} onChange={event => setIncludeFinalized(event.target.checked)} />Show past finalized consultations</label>
      </div>}
      {error && personalCalendar && <CalendarToolbar heading={heading} view={view} loading={false} onPrevious={() => navigate(-1)} onNext={() => navigate(1)} onToday={goToday} onView={changeView} />}
      {error ? (
        <CalendarError
          message={error}
          onRetry={() => setRetryKey((value) => value + 1)}
          retryable={errorRetryable}
        />
      ) : (
        <div className={`${showUpcoming ? "faculty-calendar-layout" : ""} grid min-w-0 gap-4 xl:gap-5`}>
          <section className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <CalendarToolbar
              heading={heading}
              view={view}
              loading={loading}
              onPrevious={() => navigate(-1)}
              onNext={() => navigate(1)}
              onToday={goToday}
              onView={changeView}
            />
            {loading ? (
              <CalendarSkeleton />
            ) : (
              <>
                <div className="hidden md:block">
                  {view === "month" ? (
                    <MonthView
                      anchor={anchor}
                      dates={range(42, period.start)}
                      eventsByDate={eventsByDate}
                      today={today}
                      onChooseDate={chooseDate}
                      onOpenEvent={openEvent}
                      onMore={(key, opener) => setExpandedDay({ key, opener })}
                    />
                  ) : (
                    <WeekView
                      dates={range(7, period.start)}
                      eventsByDate={eventsByDate}
                      today={today}
                      onOpenEvent={openEvent}
                    />
                  )}
                </div>
                <MobileCalendar
                  anchor={anchor}
                  selectedDate={selectedDate}
                  view={view}
                  eventsByDate={eventsByDate}
                  today={today}
                  onChooseDate={chooseDate}
                  onOpenEvent={openEvent}
                />
                {events.length === 0 && (
                  <p className="border-t border-slate-200 px-4 py-4 text-center text-sm text-slate-500">
                    {emptyMessage || `No consultations are scheduled in this ${view}.`}
                  </p>
                )}
                <CalendarLegend includeAvailability={includeAvailability} personalCalendar={personalCalendar} includeFinalized={includeFinalized} />
              </>
            )}
          </section>

          {showUpcoming && (
            <UpcomingPanel
              consultationsPath={consultationsPath}
              items={upcoming}
              loading={loading}
              onOpenEvent={openEvent}
            />
          )}
        </div>
      )}

      {expandedDay && (
        <DayEventsModal
          dateKey={expandedDay.key}
          events={eventsByDate.get(expandedDay.key) || []}
          opener={expandedDay.opener}
          onClose={() => setExpandedDay(null)}
          onOpenEvent={openEvent}
        />
      )}
      {selectedEvent && (
        <CalendarEventModal
          event={selectedEvent.event}
          opener={selectedEvent.opener}
          onClose={() => setSelectedEvent(null)}
        />
      )}
    </div>
  );
}

function CalendarToolbar({
  heading,
  view,
  loading,
  onPrevious,
  onNext,
  onToday,
  onView,
}) {
  return (
    <div className="grid min-w-0 gap-3 border-b border-slate-200 p-3 sm:p-4 md:grid-cols-[auto_minmax(0,1fr)_auto] md:items-center">
      <div className="flex min-w-0 items-center gap-2">
        <button
          type="button"
          onClick={onPrevious}
          disabled={loading}
          aria-label={`Previous ${view}`}
          className="btn-secondary h-10 w-10 shrink-0 px-0"
        >
          <ChevronLeft size={18} aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={loading}
          aria-label={`Next ${view}`}
          className="btn-secondary h-10 w-10 shrink-0 px-0"
        >
          <ChevronRight size={18} aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={onToday}
          disabled={loading}
          className="btn-secondary h-10"
        >
          Today
        </button>
      </div>
      <h2 className="min-w-0 break-words text-center text-lg font-bold text-slate-900 sm:text-xl">
        {heading}
      </h2>
      <div
        className="grid grid-cols-2 rounded-lg border border-maroon-200 bg-white p-0.5"
        role="group"
        aria-label="Calendar view"
      >
        {[
          ["month", "Month"],
          ["week", "Week"],
        ].map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => onView(value)}
            disabled={loading}
            aria-pressed={view === value}
            className={`h-9 rounded-md px-4 text-sm font-semibold transition ${view === value ? "bg-maroon-800 text-white shadow-sm" : "text-maroon-800 hover:bg-maroon-50"}`}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

function MonthView({
  anchor,
  dates,
  eventsByDate,
  today,
  onChooseDate,
  onOpenEvent,
  onMore,
}) {
  return (
    <div className="min-w-0 p-3 sm:p-4">
      <div className="grid grid-cols-7 overflow-hidden rounded-xl border border-slate-200">
        {WEEKDAYS.map((day) => (
          <div
            key={day}
            className="border-b border-r border-slate-200 bg-slate-50 px-1 py-2 text-center text-[10px] font-bold uppercase tracking-wide text-slate-600 last:border-r-0 lg:text-xs"
          >
            {day}
          </div>
        ))}
        {dates.map((key, index) => {
          const dayEvents = eventsByDate.get(key) || [];
          const currentMonth = key.slice(0, 7) === anchor.slice(0, 7);
          return (
            <div
              key={key}
              className={`min-h-28 min-w-0 border-b border-r border-slate-200 p-1.5 last:border-r-0 lg:min-h-32 lg:p-2 ${index % 7 === 6 ? "border-r-0" : ""} ${index >= 35 ? "border-b-0" : ""} ${currentMonth ? "bg-white" : "bg-slate-50/70"}`}
            >
              <button
                type="button"
                onClick={() => onChooseDate(key)}
                aria-label={dateLabel(key, {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                  year: "numeric",
                })}
                className={`grid h-7 w-7 place-items-center rounded-full text-xs font-semibold ${key === today ? "bg-gold-200 text-maroon-900 ring-1 ring-gold-400" : currentMonth ? "text-slate-800 hover:bg-slate-100" : "text-slate-400"}`}
              >
                {Number(key.slice(-2))}
              </button>
              <div className="mt-1 space-y-1">
                {dayEvents.slice(0, 3).map((event) => (
                  <CalendarEventPill
                    key={event.id}
                    event={event}
                    onOpen={onOpenEvent}
                  />
                ))}
                {dayEvents.length > 3 && (
                  <button
                    type="button"
                    onClick={(event) => onMore(key, event.currentTarget)}
                    className="w-full rounded px-1 py-0.5 text-left text-[10px] font-bold text-maroon-800 hover:bg-maroon-50"
                    aria-label={`Show all ${dayEvents.length} consultations for ${dateLabel(key, { month: "long", day: "numeric" })}`}
                  >
                    +{dayEvents.length - 3} more
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CalendarEventPill({ event, onOpen }) {
  const style = eventStyle(event.status);
  return (
    <button
      type="button"
      onClick={(clickEvent) => onOpen(event, clickEvent.currentTarget)}
      aria-label={`${event.displayStatus || event.status} consultation with ${eventParticipantName(event)} about ${event.topic || "Consultation"} at ${timeLabel(event.start)}`}
      className={`block w-full min-w-0 overflow-hidden rounded-md border px-1.5 py-1 text-left text-[10px] leading-3 transition hover:brightness-95 ${style.event}`}
    >
      <span className="flex min-w-0 items-center gap-1 font-bold">
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${style.dot}`} />
        <span className="truncate">{timeLabel(event.start)}</span>
      </span>
      <span className="block break-words font-semibold">{event.displayStatus || event.status}</span>
      <span className="mt-0.5 block truncate font-semibold">
        {eventParticipantName(event)} · {event.topic}
      </span>
    </button>
  );
}

function WeekView({ dates, eventsByDate, today, onOpenEvent }) {
  return (
    <div className="min-w-0 p-3 sm:p-4">
      <div className="grid min-w-0 grid-cols-7 overflow-hidden rounded-xl border border-slate-200">
        {dates.map((key) => {
          const dayEvents = eventsByDate.get(key) || [];
          return (
            <section
              key={key}
              className={`min-h-[28rem] min-w-0 border-r border-slate-200 bg-white last:border-r-0 ${key === today ? "bg-gold-50/60" : ""}`}
            >
              <header className="border-b border-slate-200 bg-slate-50 px-1 py-2 text-center">
                <p className="text-[10px] font-bold uppercase text-slate-500 lg:text-xs">
                  {dateLabel(key, { weekday: "short" })}
                </p>
                <p
                  className={`mx-auto mt-1 grid h-7 w-7 place-items-center rounded-full text-sm font-bold ${key === today ? "bg-gold-200 text-maroon-900" : "text-slate-800"}`}
                >
                  {Number(key.slice(-2))}
                </p>
              </header>
              <div className="space-y-1.5 p-1.5 lg:p-2">
                {dayEvents.length ? (
                  dayEvents.map((event) => (
                    <WeekEvent
                      key={event.id}
                      event={event}
                      onOpen={onOpenEvent}
                    />
                  ))
                ) : (
                  <p className="pt-4 text-center text-[10px] text-slate-400">
                    No consultations
                  </p>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function WeekEvent({ event, onOpen }) {
  const style = eventStyle(event.status);
  return (
    <button
      type="button"
      onClick={(clickEvent) => onOpen(event, clickEvent.currentTarget)}
      className={`w-full min-w-0 rounded-lg border p-1.5 text-left text-[10px] leading-4 transition hover:brightness-95 ${style.event}`}
      aria-label={`Open ${event.displayStatus || event.status} consultation with ${eventParticipantName(event)}`}
    >
      <span className="block break-words font-bold">
        {timeLabel(event.start)}–{timeLabel(event.end)}
      </span>
      <span className="block break-words font-semibold">
        {eventParticipantName(event)}
      </span>
      <span className="block break-words opacity-80">{event.topic}</span>
      <span className="block break-words font-semibold">{event.displayStatus || event.status}</span>
    </button>
  );
}

function MobileCalendar({
  selectedDate,
  eventsByDate,
  today,
  onChooseDate,
  onOpenEvent,
}) {
  const dates = range(7, weekStart(selectedDate));
  const selectedEvents = eventsByDate.get(selectedDate) || [];
  return (
    <div className="min-w-0 p-3 md:hidden">
      <div className="grid grid-cols-7 gap-1" aria-label="Select a day">
        {dates.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => onChooseDate(key)}
            aria-pressed={selectedDate === key}
            className={`min-w-0 rounded-lg border px-0.5 py-2 text-center ${selectedDate === key ? "border-maroon-700 bg-maroon-800 text-white" : key === today ? "border-gold-400 bg-gold-50 text-maroon-900" : "border-slate-200 bg-white text-slate-700"}`}
          >
            <span className="block text-[9px] font-bold uppercase">
              {dateLabel(key, { weekday: "short" })}
            </span>
            <span className="mt-1 block text-sm font-extrabold">
              {Number(key.slice(-2))}
            </span>
          </button>
        ))}
      </div>
      <h3 className="mt-4 break-words text-sm font-bold text-maroon-900">
        {dateLabel(selectedDate, {
          weekday: "long",
          month: "long",
          day: "numeric",
          year: "numeric",
        })}
      </h3>
      <div className="mt-2 space-y-2">
        {selectedEvents.length ? (
          selectedEvents.map((event) => (
            <AgendaCard key={event.id} event={event} onOpen={onOpenEvent} />
          ))
        ) : (
          <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
            No consultations scheduled for this date.
          </p>
        )}
      </div>
    </div>
  );
}

function AgendaCard({ event, onOpen }) {
  const style = eventStyle(event.status);
  return (
    <button
      type="button"
      onClick={(clickEvent) => onOpen(event, clickEvent.currentTarget)}
      className={`w-full min-w-0 rounded-xl border p-3 text-left ${style.event}`}
    >
      <span className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-bold">
          {timeLabel(event.start)} – {timeLabel(event.end)}
        </span>
        <span className="text-xs font-bold">{event.displayStatus || event.status}</span>
      </span>
      <span className="mt-1 block break-words text-sm font-semibold">
        {eventParticipantName(event)}
      </span>
      <span className="mt-0.5 block break-words text-xs opacity-80">
        {event.topic}
      </span>
    </button>
  );
}

function UpcomingPanel({ items, loading, onOpenEvent, consultationsPath }) {
  return (
    <aside className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <h2 className="text-lg font-bold text-maroon-900 sm:text-xl">
        Upcoming Consultations
      </h2>
      {loading ? (
        <div
          className="mt-4 space-y-3"
          aria-label="Loading upcoming consultations"
        >
          {[0, 1, 2].map((item) => (
            <div
              key={item}
              className="h-24 animate-pulse rounded-xl bg-slate-100"
            />
          ))}
        </div>
      ) : items.length ? (
        <div className="mt-4 space-y-3">
          {items.map((event) => (
            <button
              key={event.id}
              type="button"
              onClick={(clickEvent) =>
                onOpenEvent(event, clickEvent.currentTarget)
              }
              className="grid w-full min-w-0 grid-cols-[3.5rem_minmax(0,1fr)] gap-3 rounded-xl border border-slate-200 p-3 text-left transition hover:border-maroon-300 hover:bg-maroon-50/30"
            >
              <span className="grid min-h-16 place-items-center rounded-xl bg-maroon-50 px-1 text-center text-maroon-900">
                <span>
                  <span className="block text-[10px] font-extrabold uppercase">
                    {new Intl.DateTimeFormat("en-PH", {
                      timeZone: TIMEZONE,
                      month: "short",
                    }).format(new Date(event.start))}
                  </span>
                  <span className="block text-xl font-extrabold leading-6">
                    {dateParts(new Date(event.start)).day}
                  </span>
                </span>
              </span>
              <span className="min-w-0">
                <span className="flex min-w-0 flex-wrap items-start justify-between gap-1">
                  <span className="min-w-0 break-words text-sm font-bold text-slate-900">
                    {eventParticipantName(event)}
                  </span>
                  <CalendarStatus event={event} compact />
                </span>
                <span className="mt-1 block text-xs font-semibold text-slate-600">
                  {timeLabel(event.start)} – {timeLabel(event.end)}
                </span>
                <span className="mt-1 block break-words text-xs text-slate-500">
                  {event.mode}
                </span>
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div className="mt-4 rounded-xl border border-dashed border-slate-200 bg-slate-50 p-5 text-center">
          <CalendarDays
            size={24}
            className="mx-auto text-maroon-700"
            aria-hidden="true"
          />
          <p className="mt-2 font-bold text-slate-800">
            No upcoming consultations
          </p>
          <p className="mt-1 text-sm text-slate-500">
            Your approved consultations will appear here.
          </p>
        </div>
      )}
      <Link
        to={consultationsPath}
        className="btn-secondary mt-4 flex h-11 w-full"
      >
        View all appointments
      </Link>
    </aside>
  );
}

function CalendarStatus({ event, compact = false }) {
  return event.displayStatus ? <span className={`rounded-full border px-2 py-1 text-xs font-semibold ${eventStyle(event.status).event}`}>{event.displayStatus}</span>
    : <StatusBadge appointment status={event.status} compact={compact} allowWrap />;
}

function CalendarLegend({ includeAvailability, personalCalendar, includeFinalized }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-2 border-t border-slate-200 px-4 py-3 text-xs text-slate-600">
      {Object.entries({ ...STATUS_STYLES, ...(personalCalendar && includeFinalized ? FINALIZED_STYLES : {}) }).filter(([status]) => (includeAvailability || !["Available", "Pending", "Inactive"].includes(status)) && (!personalCalendar || includeFinalized || status !== "Completed")).map(([status, style]) => (
        <span key={status} className="inline-flex items-center gap-1.5">
          <span className={`h-2.5 w-2.5 rounded-full ${style.dot}`} />
          {includeAvailability && status === "Pending" ? "Pending request" : includeAvailability && status === "Confirmed" ? "Confirmed consultation" : status === "Inactive" ? "Inactive / unavailable" : status}
        </span>
      ))}
    </div>
  );
}

function CalendarSkeleton() {
  return (
    <div className="animate-pulse p-3 sm:p-4" aria-label="Loading calendar">
      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: 42 }, (_, index) => (
          <div key={index} className="h-20 rounded bg-slate-100 md:h-28" />
        ))}
      </div>
    </div>
  );
}

function CalendarError({ message, onRetry, retryable }) {
  return (
    <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-center">
      <p className="font-bold text-red-800">Unable to load the calendar</p>
      <p className="mt-1 text-sm text-red-700">{message}</p>
      {retryable && <button type="button" onClick={onRetry} className="btn-secondary mt-4">Retry</button>}
    </div>
  );
}

function DayEventsModal({ dateKey, events, opener, onClose, onOpenEvent }) {
  return (
    <ModalShell
      title={dateLabel(dateKey, {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
      })}
      opener={opener}
      onClose={onClose}
      labelledBy="calendar-day-events-title"
    >
      <div className="space-y-2 p-4 sm:p-5">
        {events.map((event) => (
          <AgendaCard key={event.id} event={event} onOpen={onOpenEvent} />
        ))}
      </div>
    </ModalShell>
  );
}

function CalendarEventModal({ event, opener, onClose }) {
  if (event.kind === "availability") return (
    <ModalShell title={event.status === "Available" ? "Available slot" : "Inactive / unavailable slot"} labelledBy="availability-event-title" opener={opener} onClose={onClose}>
      <dl className="grid gap-4 p-5 sm:grid-cols-2">
        <ModalDetail label="Date" value={fullDateLabel(event.start)} />
        <ModalDetail label="Time (Asia/Manila)" value={timeLabel(event.start) + " – " + timeLabel(event.end)} />
        <ModalDetail label="Status" value={event.status === "Inactive" ? "Inactive / unavailable" : "Available"} />
        <ModalDetail label="Mode" value={event.mode} />
        <ModalDetail label={event.mode === "Online" ? "Meeting platform" : "Location"} value={event.mode === "Online" ? event.meetingPlatform : event.location} />
      </dl>
    </ModalShell>
  );
  return (
    <ModalShell
      title="Consultation Details"
      opener={opener}
      onClose={onClose}
      labelledBy="calendar-event-details-title"
    >
      <div className="min-h-0 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="break-words text-lg font-bold text-maroon-900">
              {event.topic}
            </p>
            <p className="mt-1 break-words text-sm font-semibold text-slate-700">
              {eventParticipantName(event)}
            </p>
          </div>
          <CalendarStatus event={event} />
        </div>
        <dl className="mt-5 grid min-w-0 gap-4 sm:grid-cols-2">
          <ModalDetail label="Date" value={fullDateLabel(event.start)} />
          <ModalDetail
            label="Time"
            value={`${timeLabel(event.start)} – ${timeLabel(event.end)}`}
          />
          <ModalDetail
            label="Duration"
            value={
              event.duration ? `${event.duration} minutes` : "Not provided"
            }
          />
          <ModalDetail label="Mode" value={event.mode} />
          {event.mode === "Face-to-Face" ? (
            <ModalDetail label="Location" value={event.location} wide />
          ) : (
            <>
              <ModalDetail
                label="Meeting platform"
                value={event.meetingPlatform}
              />
              <ModalDetail
                label="Meeting link"
                value={
                  event.meetingLink ? (
                    <a
                      href={event.meetingLink}
                      target="_blank"
                      rel="noreferrer"
                      className="break-all font-semibold text-maroon-700 underline"
                    >
                      Open meeting link
                    </a>
                  ) : (
                    "Not provided"
                  )
                }
              />
            </>
          )}
          <ModalDetail label="Status" value={event.displayStatus || event.status} />
          <ModalDetail label="Reason / notes" value={event.reason} wide />
          {event.responseNote && (
            <ModalDetail
              label="Faculty response"
              value={event.responseNote}
              wide
            />
          )}
        </dl>
      </div>
    </ModalShell>
  );
}

function ModalShell({ title, labelledBy, opener, onClose, children }) {
  const panelRef = useRef(null);
  useDialogFocus(panelRef, { onClose, restoreTarget: opener });
  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center overflow-y-auto bg-slate-950/60 p-4 sm:p-6"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        ref={panelRef} tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        onMouseDown={(event) => event.stopPropagation()}
        className="flex max-h-[calc(100dvh-48px)] w-[min(680px,calc(100vw-32px))] min-w-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl outline-none"
      >
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-200 px-4 py-4 sm:px-6">
          <h2
            id={labelledBy}
            className="break-words text-xl font-bold text-maroon-900"
          >
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-slate-500 hover:bg-slate-100"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </header>
        {children}
        <footer className="flex shrink-0 justify-end border-t border-slate-200 bg-white px-4 py-3 sm:px-6">
          <button type="button" onClick={onClose} className="btn-secondary">
            Close
          </button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}

function ModalDetail({ label, value, wide = false }) {
  return (
    <div
      className={`min-w-0 rounded-xl border border-slate-200 bg-slate-50 p-3 ${wide ? "sm:col-span-2" : ""}`}
    >
      <dt className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
        {label}
      </dt>
      <dd className="mt-1 break-words text-sm text-slate-800">
        {value || "Not provided"}
      </dd>
    </div>
  );
}
