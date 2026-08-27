import {
  Bell,
  CalendarDays,
  CalendarCheck,
  CheckCircle2,
  CheckSquare,
  ChevronRight,
  ChevronUp,
  Clock3,
  Eye,
  Mail,
  MailOpen,
  Trash2,
  X,
  XCircle,
} from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../../api/apiClient";
import { EmptyState, ErrorState, StatusBadge } from "../UI";
import Pagination from "../Pagination";
import { useToast } from "../../context/ToastContext";
import ConfirmDialog from "../ConfirmDialog";
import { formatPersonNameInNotification } from "../../utils/formatPersonName";

const ITEMS_PER_PAGE = 6;

const iconFor = (notification) => {
  if (notification.type === "task") return CheckSquare;
  if (/rejected|cancelled/i.test(notification.title || "")) return XCircle;
  if (/approved|completed/i.test(notification.title || ""))
    return CalendarCheck;
  if (/pending|rescheduled|request/i.test(notification.title || ""))
    return Clock3;
  return Bell;
};

export default function NotificationsPage({
  compact = false,
  admin = false,
  student = false,
}) {
  const toast = useToast();
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("All");
  const [currentPage, setCurrentPage] = useState(1);
  const [selected, setSelected] = useState(null);
  const [confirmation, setConfirmation] = useState(null);
  const [mutating, setMutating] = useState(false);
  const [markingUnread, setMarkingUnread] = useState(false);

  const load = (background = false) => {
    if (!background) setLoading(true);
    setError("");
    return api("/notifications")
      .then((data) => {
        setNotifications(
          Array.isArray(data?.notifications) ? data.notifications : [],
        );
        setUnreadCount(Number(data?.unreadCount) || 0);
      })
      .catch(() => setError("Unable to load notifications. Please try again."))
      .finally(() => !background && setLoading(false));
  };
  useEffect(() => {
    void load();
    const refresh = () => void load(true);
    const timer = window.setInterval(refresh, 15000);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, []);

  const refreshBadge = (nextUnreadCount) =>
    window.dispatchEvent(
      Number.isFinite(nextUnreadCount)
        ? new CustomEvent("notifications:updated", {
            detail: { unreadCount: nextUnreadCount },
          })
        : new Event("notifications:updated"),
    );
  const read = async (id) => {
    try {
      await api(`/notifications/${id}/read`, { method: "PUT" });
      setNotifications((current) =>
        current.map((item) =>
          item._id === id
            ? { ...item, isRead: true, readAt: new Date().toISOString() }
            : item,
        ),
      );
      setSelected((current) =>
        current?._id === id
          ? { ...current, isRead: true, readAt: new Date().toISOString() }
          : current,
      );
      setUnreadCount((current) => Math.max(0, current - 1));
      refreshBadge();
    } catch {
      toast.error("Unable to update this notification. Please try again.");
    }
  };
  const readAll = async () => {
    try {
      await api("/notifications/read-all", { method: "PUT" });
      setNotifications((current) =>
        current.map((item) => ({
          ...item,
          isRead: true,
          readAt: item.readAt || new Date().toISOString(),
        })),
      );
      setUnreadCount(0);
      refreshBadge();
    } catch {
      toast.error("Unable to update notifications. Please try again.");
    }
  };
  const unreadAll = async () => {
    if (markingUnread) return;
    setMarkingUnread(true);
    try {
      const data = await api("/notifications/unread-all", { method: "PUT" });
      setNotifications((current) =>
        current.map((item) => ({
          ...item,
          isRead: false,
          readAt: undefined,
        })),
      );
      setSelected((current) =>
        current ? { ...current, isRead: false, readAt: undefined } : current,
      );
      const nextUnreadCount = Number(data?.unreadCount) || notifications.length;
      setUnreadCount(nextUnreadCount);
      toast.success(data.message || "All notifications marked as unread.");
      refreshBadge(nextUnreadCount);
    } catch {
      toast.error("Unable to update notifications. Please try again.");
    } finally {
      setMarkingUnread(false);
    }
  };
  const confirmDelete = (notification) =>
    setConfirmation({ type: "delete", notification });
  const confirmClear = (scope) => setConfirmation({ type: scope });
  const performConfirmedAction = async () => {
    if (!confirmation || mutating) return;
    setMutating(true);
    try {
      if (confirmation.type === "delete") {
        const notification = confirmation.notification;
        await api(`/notifications/${notification._id}`, { method: "DELETE" });
        setNotifications((current) =>
          current.filter((item) => item._id !== notification._id),
        );
        if (!notification.isRead)
          setUnreadCount((current) => Math.max(0, current - 1));
        if (selected?._id === notification._id) setSelected(null);
        toast.success("Notification deleted.");
      } else if (confirmation.type === "read") {
        await api("/notifications/read", { method: "DELETE" });
        setNotifications((current) =>
          current.filter((notification) => !notification.isRead),
        );
        if (selected?.isRead) setSelected(null);
        toast.success("Read notifications cleared.");
      } else {
        await api("/notifications", { method: "DELETE" });
        setNotifications([]);
        setUnreadCount(0);
        setSelected(null);
        toast.success("All notifications cleared.");
      }
      setConfirmation(null);
      refreshBadge();
    } catch {
      toast.error(
        confirmation.type === "delete"
          ? "Unable to delete notification. Please try again."
          : "Unable to clear notifications. Please try again.",
      );
    } finally {
      setMutating(false);
    }
  };

  if (error && notifications.length === 0)
    return <ErrorState message={error} onRetry={load} />;
  if (compact)
    return (
      <>
        {student ? (
          <StudentNotificationsContent
            notifications={notifications}
            unreadCount={unreadCount}
            loading={loading}
            error={error}
            filter={filter}
            setFilter={setFilter}
            currentPage={currentPage}
            setCurrentPage={setCurrentPage}
            selected={selected}
            setSelected={setSelected}
            read={read}
            readAll={readAll}
            unreadAll={unreadAll}
            markingUnread={markingUnread}
            confirmDelete={confirmDelete}
            confirmClear={confirmClear}
          />
        ) : (
          <CompactNotifications
            notifications={notifications}
            unreadCount={unreadCount}
            loading={loading}
            error={error}
            filter={filter}
            setFilter={setFilter}
            currentPage={currentPage}
            setCurrentPage={setCurrentPage}
            selected={selected}
            setSelected={setSelected}
            read={read}
            readAll={readAll}
            unreadAll={unreadAll}
            markingUnread={markingUnread}
            confirmDelete={confirmDelete}
            confirmClear={confirmClear}
            admin={admin}
          />
        )}
        {confirmation && (
          <DeleteConfirmationModal
            action={confirmation.type}
            loading={mutating}
            onCancel={() => !mutating && setConfirmation(null)}
            onConfirm={performConfirmedAction}
          />
        )}
      </>
    );
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="page-title">Notifications</h1>
          <p className="mt-2 text-sm text-slate-600">
            Stay updated with your consultation activities.
          </p>
        </div>
        <NotificationActions
          notifications={notifications}
          unreadCount={unreadCount}
          onReadAll={readAll}
          onUnreadAll={unreadAll}
          markingUnread={markingUnread}
          onClear={confirmClear}
        />
      </div>
      {error && (
        <p className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </p>
      )}
      {loading ? (
        <p className="py-12 text-center font-semibold text-maroon-800">
          Loading notifications...
        </p>
      ) : notifications.length === 0 ? (
        <EmptyState
          title="No notifications yet."
          text="Updates about your consultations will appear here."
        />
      ) : (
        <div className="space-y-3">
          {notifications.map((notification) => {
            const Icon = iconFor(notification);
            const createdAt = new Date(notification.createdAt);
            return (
              <article
                key={notification._id}
                className={`rounded-2xl border p-5 shadow-sm ${notification.isRead ? "border-slate-200 bg-white" : "border-gold-300 bg-gold-50"}`}
              >
                <div className="flex gap-4">
                  <span
                    className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${notification.isRead ? "bg-slate-100 text-slate-600" : "bg-maroon-800 text-gold-300"}`}
                  >
                    <Icon size={20} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-3">
                      <h2
                        className={`${notification.isRead ? "font-semibold" : "font-bold"} text-slate-900`}
                      >
                        {notification.title || "SOCConsult Notification"}
                      </h2>
                      {!notification.isRead && (
                        <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-gold-500" />
                      )}
                    </div>
                    <p className="mt-2 text-sm leading-6 text-slate-600">
                      {formatPersonNameInNotification(notification.message) ||
                        "A SOCConsult activity was updated."}
                    </p>
                    <p className="mt-2 text-xs text-slate-500">
                      {Number.isNaN(createdAt.getTime())
                        ? "Date unavailable"
                        : createdAt.toLocaleString()}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-4">
                      {!notification.isRead && (
                        <button
                          type="button"
                          onClick={() => read(notification._id)}
                          className="text-sm font-bold text-maroon-800"
                        >
                          Mark as Read
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => confirmDelete(notification)}
                        className="text-sm font-bold text-red-700"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
      {confirmation && (
        <DeleteConfirmationModal
          action={confirmation.type}
          loading={mutating}
          onCancel={() => !mutating && setConfirmation(null)}
          onConfirm={performConfirmedAction}
        />
      )}
    </div>
  );
}

function StudentNotificationsContent({
  notifications,
  unreadCount,
  loading,
  error,
  filter,
  setFilter,
  currentPage,
  setCurrentPage,
  selected,
  setSelected,
  read,
  readAll,
  unreadAll,
  markingUnread,
  confirmDelete,
  confirmClear,
}) {
  const [expandedNotificationId, setExpandedNotificationId] = useState(null);
  const shown = notifications.filter((notification) =>
    filter === "Unread"
      ? !notification.isRead
      : filter === "Read"
        ? notification.isRead
        : true,
  );
  const totalPages = Math.max(1, Math.ceil(shown.length / ITEMS_PER_PAGE));
  const safePage = Math.min(currentPage, totalPages);
  const pageNotifications = shown.slice(
    (safePage - 1) * ITEMS_PER_PAGE,
    safePage * ITEMS_PER_PAGE,
  );

  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [currentPage, setCurrentPage, totalPages]);

  useEffect(() => {
    setExpandedNotificationId(null);
  }, [filter]);

  useEffect(() => {
    if (
      expandedNotificationId &&
      !pageNotifications.some(
        (notification) => notification._id === expandedNotificationId,
      )
    ) {
      setExpandedNotificationId(null);
    }
  }, [expandedNotificationId, pageNotifications]);

  const open = async (notification) => {
    setSelected(notification);
    if (!notification.isRead) await read(notification._id);
  };
  const date = (value) => {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime())
      ? "Date unavailable"
      : parsed.toLocaleString(undefined, {
          year: "numeric",
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        });
  };
  const typeLabel = (notification) =>
    notification.type
      ? notification.type.charAt(0).toUpperCase() + notification.type.slice(1)
      : "Update";
  const notificationDateParts = (value) => {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return { month: "---", day: "--", year: "" };
    }
    return {
      month: parsed.toLocaleString(undefined, { month: "short" }).toUpperCase(),
      day: parsed.toLocaleString(undefined, { day: "2-digit" }),
      year: parsed.toLocaleString(undefined, { year: "numeric" }),
    };
  };
  const changePage = (page) => {
    setExpandedNotificationId(null);
    setCurrentPage(page);
  };
  const emptyCopy =
    filter === "Unread"
      ? { title: "You're all caught up.", text: "No unread notifications." }
      : filter === "Read"
        ? {
            title: "No read notifications found.",
            text: "Notifications you read will appear here.",
          }
        : {
            title: "No notifications yet.",
            text: "Updates about your consultations will appear here.",
          };

  return (
    <div className="student-notifications w-full min-w-0 max-w-full space-y-4 pb-16 sm:space-y-5 md:pb-0">
      <div className="student-notifications-heading flex min-w-0 flex-col gap-4">
        <div className="min-w-0 pt-1">
          <h1 className="text-2xl font-extrabold tracking-tight text-maroon-900 md:text-[28px]">
            Notifications
          </h1>
          <p className="mt-1.5 text-sm text-slate-600 md:text-[15px]">
            Stay updated with your consultation activities.
          </p>
        </div>
        <StudentNotificationActions
          notifications={notifications}
          unreadCount={unreadCount}
          onReadAll={readAll}
          onUnreadAll={unreadAll}
          markingUnread={markingUnread}
          onClear={confirmClear}
        />
      </div>

      <div className="flex w-full max-w-md min-w-0 rounded-xl bg-slate-100 p-1 md:w-auto md:max-w-none md:gap-2 md:bg-transparent md:p-0">
        {["All", "Unread", "Read"].map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => {
              setExpandedNotificationId(null);
              setFilter(name);
              setCurrentPage(1);
            }}
            aria-pressed={filter === name}
            className={`h-9 min-w-0 flex-1 rounded-lg px-3 text-sm font-semibold transition focus-visible:ring-2 focus-visible:ring-maroon-200 md:min-w-20 md:flex-none ${filter === name ? "bg-maroon-800 text-white shadow-sm" : "border border-transparent bg-transparent text-slate-700 hover:bg-white md:border-slate-200 md:bg-white"}`}
          >
            {name}
          </button>
        ))}
      </div>

      {error && (
        <p className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </p>
      )}

      {loading ? (
        <div className="grid min-h-48 place-items-center rounded-2xl border border-slate-200 bg-white">
          <p className="font-semibold text-maroon-800">
            Loading notifications...
          </p>
        </div>
      ) : shown.length === 0 ? (
        <EmptyState title={emptyCopy.title} text={emptyCopy.text} />
      ) : (
        <div className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm md:rounded-2xl">
          <div className="student-notifications-table min-w-0">
            <table className="w-full table-fixed text-left text-xs min-[1450px]:text-[13px]">
              <thead className="bg-maroon-800 text-[11px] uppercase tracking-wide text-white">
                <tr>
                  <th scope="col" className="w-[14%] px-3 py-3">
                    Type
                  </th>
                  <th scope="col" className="w-[29%] px-3 py-3">
                    Notification
                  </th>
                  <th scope="col" className="w-[19%] px-3 py-3">
                    Date &amp; Time
                  </th>
                  <th scope="col" className="w-[10%] px-3 py-3 text-center">
                    Status
                  </th>
                  <th scope="col" className="w-[28%] px-3 py-3">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {pageNotifications.map((notification) => (
                  <tr
                    key={notification._id}
                    className={
                      notification.isRead ? "bg-white" : "bg-gold-50/70"
                    }
                  >
                    <td className="px-3 py-2.5 text-slate-700">
                      <span className="flex min-w-0 items-center gap-2">
                        <CalendarDays
                          size={16}
                          className="shrink-0 text-maroon-700"
                          aria-hidden="true"
                        />
                        <span className="min-w-0 break-words">
                          {typeLabel(notification)}
                        </span>
                      </span>
                    </td>
                    <td className="min-w-0 px-3 py-2.5">
                      <div className="flex min-w-0 items-start gap-2">
                        <span
                          className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${notification.isRead ? "bg-blue-300" : "bg-gold-500"}`}
                          aria-hidden="true"
                        />
                        <p
                          className={`min-w-0 break-words leading-5 text-slate-800 ${notification.isRead ? "font-medium" : "font-bold"}`}
                        >
                          {notification.title || "SOCConsult Notification"}
                        </p>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 leading-5 text-slate-600">
                      {date(notification.createdAt)}
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <StatusBadge
                        status={notification.isRead ? "Read" : "Unread"}
                        compact
                      />
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => open(notification)}
                          className="btn-action-sm gap-1.5"
                        >
                          <Eye size={14} aria-hidden="true" /> View
                        </button>
                        {!notification.isRead && (
                          <button
                            type="button"
                            onClick={() => read(notification._id)}
                            className="btn-action-sm gap-1.5"
                          >
                            <MailOpen size={14} aria-hidden="true" /> Mark Read
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => confirmDelete(notification)}
                          className="btn-danger-action-sm gap-1.5"
                        >
                          <Trash2 size={14} aria-hidden="true" /> Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="student-notifications-cards grid min-w-0 gap-2.5 bg-slate-50/70 p-2 sm:p-3">
            {pageNotifications.map((notification) => {
              const dateParts = notificationDateParts(notification.createdAt);
              const isExpanded = expandedNotificationId === notification._id;
              const detailsId = `student-notification-details-${notification._id}`;
              return (
                <article
                  key={notification._id}
                  className={`min-w-0 overflow-hidden rounded-xl border shadow-sm transition-colors duration-200 ${notification.isRead ? "border-slate-200 bg-white" : "border-gold-200 bg-gold-50/60"}`}
                >
                  <div className="grid min-h-[92px] min-w-0 grid-cols-[3.25rem_minmax(0,1fr)_auto] items-center gap-2.5 p-3 sm:gap-3 sm:p-4">
                    <div className="grid h-[4.5rem] w-[3.25rem] shrink-0 place-content-center rounded-lg border border-maroon-100 bg-maroon-50/70 text-center text-maroon-800">
                      <span className="text-[10px] font-bold leading-3">
                        {dateParts.month}
                      </span>
                      <span className="mt-0.5 text-xl font-extrabold leading-6">
                        {dateParts.day}
                      </span>
                      <span className="mt-0.5 text-[9px] font-medium leading-3">
                        {dateParts.year}
                      </span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-start gap-2">
                        <span
                          className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${notification.isRead ? "bg-blue-400" : "bg-gold-500"}`}
                          aria-hidden="true"
                        />
                        <p
                          className={`min-w-0 break-words text-sm leading-5 text-slate-900 ${notification.isRead ? "font-semibold" : "font-bold"}`}
                        >
                          {notification.title || "SOCConsult Notification"}
                        </p>
                      </div>
                      <p className="mt-1 break-words text-[11px] leading-4 text-slate-500">
                        <span className="font-semibold text-maroon-700">
                          {typeLabel(notification)}
                        </span>
                        <span aria-hidden="true"> · </span>
                        {date(notification.createdAt)}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-0.5 self-center">
                      <StatusBadge
                        status={notification.isRead ? "Read" : "Unread"}
                        compact
                      />
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedNotificationId((currentId) =>
                            currentId === notification._id
                              ? null
                              : notification._id,
                          )
                        }
                        aria-expanded={isExpanded}
                        aria-controls={detailsId}
                        aria-label={`${isExpanded ? "Collapse" : "Expand"} notification actions for ${notification.title || "SOCConsult Notification"}`}
                        className="grid h-9 w-8 shrink-0 place-items-center rounded-lg text-maroon-800 transition hover:bg-maroon-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-maroon-300"
                      >
                        {isExpanded ? (
                          <ChevronUp size={18} aria-hidden="true" />
                        ) : (
                          <ChevronRight size={18} aria-hidden="true" />
                        )}
                      </button>
                    </div>
                  </div>

                  {isExpanded && (
                    <div
                      id={detailsId}
                      className="mx-3 mb-3 min-w-0 rounded-xl border border-slate-200 bg-white/90 p-3 shadow-sm sm:mx-4 sm:mb-4 sm:p-4"
                    >
                      <dl className="grid min-w-0 grid-cols-1 gap-x-4 gap-y-3 min-[360px]:grid-cols-2">
                        <div className="min-w-0">
                          <dt className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                            Date
                          </dt>
                          <dd className="mt-1 break-words text-xs leading-5 text-slate-800">
                            {date(notification.createdAt)}
                          </dd>
                        </div>
                        <div className="min-w-0">
                          <dt className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                            Read status
                          </dt>
                          <dd className="mt-1 text-xs leading-5 text-slate-800">
                            {notification.isRead ? "Read" : "Unread"}
                          </dd>
                        </div>
                        <div className="min-w-0">
                          <dt className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                            Type
                          </dt>
                          <dd className="mt-1 break-words text-xs leading-5 text-slate-800">
                            {typeLabel(notification)}
                          </dd>
                        </div>
                        <div className="min-w-0">
                          <dt className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                            Notification
                          </dt>
                          <dd className="mt-1 break-words text-xs leading-5 text-slate-800">
                            {notification.title || "SOCConsult Notification"}
                          </dd>
                        </div>
                      </dl>

                      <div className="mt-4 grid min-w-0 grid-cols-2 gap-2 min-[360px]:grid-cols-3">
                        <button
                          type="button"
                          onClick={() => open(notification)}
                          className="inline-flex h-10 min-w-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-maroon-200 bg-white px-2 text-[11px] font-semibold text-maroon-800 transition hover:bg-maroon-50 focus-visible:ring-2 focus-visible:ring-maroon-200"
                        >
                          <Eye size={14} aria-hidden="true" /> View
                        </button>
                        {!notification.isRead && (
                          <button
                            type="button"
                            onClick={() => read(notification._id)}
                            className="inline-flex h-10 min-w-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-maroon-200 bg-white px-2 text-[11px] font-semibold text-maroon-800 transition hover:bg-maroon-50 focus-visible:ring-2 focus-visible:ring-maroon-200"
                          >
                            <MailOpen size={14} aria-hidden="true" /> Mark as Read
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => confirmDelete(notification)}
                          className="inline-flex h-10 min-w-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-red-200 bg-white px-2 text-[11px] font-semibold text-red-700 transition hover:bg-red-50 focus-visible:ring-2 focus-visible:ring-red-200"
                        >
                          <Trash2 size={14} aria-hidden="true" /> Delete
                        </button>
                      </div>
                    </div>
                  )}
                </article>
              );
            })}
          </div>

          <Pagination
            currentPage={safePage}
            totalItems={shown.length}
            onPageChange={changePage}
            itemLabel="notifications"
            itemsPerPage={ITEMS_PER_PAGE}
          />
        </div>
      )}

      {selected && (
        <NotificationDetailsModal
          notification={{ ...selected, isRead: true }}
          date={date}
          typeLabel={typeLabel}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

function StudentNotificationActions({
  notifications,
  unreadCount,
  onReadAll,
  onUnreadAll,
  markingUnread,
  onClear,
}) {
  if (notifications.length === 0) return null;
  const hasRead = notifications.some((notification) => notification.isRead);
  const actions = [
    {
      label: markingUnread ? "Marking Unread..." : "Mark All as Unread",
      icon: Mail,
      onClick: onUnreadAll,
      disabled: !hasRead || markingUnread,
      danger: false,
    },
    {
      label: "Mark All as Read",
      icon: CheckCircle2,
      onClick: onReadAll,
      disabled: unreadCount === 0,
      danger: false,
    },
    {
      label: "Clear Read",
      icon: MailOpen,
      onClick: () => onClear("read"),
      disabled: !hasRead,
      danger: true,
    },
    {
      label: "Clear All",
      icon: Trash2,
      onClick: () => onClear("all"),
      danger: true,
    },
  ];

  return (
    <div className="student-notifications-actions grid w-full min-w-0 grid-cols-2 gap-2 rounded-xl border border-slate-200 bg-white p-2.5 shadow-sm md:border-0 md:bg-transparent md:p-0 md:shadow-none">
      {actions.map(({ label, icon: Icon, onClick, disabled, danger }) => (
        <button
          key={label}
          type="button"
          onClick={onClick}
          disabled={disabled}
          className={`${danger ? "btn-danger-action" : "btn-action"} h-10 w-full min-w-0 justify-center gap-1.5 border-slate-200 px-1.5 text-[10px] min-[360px]:px-2 min-[360px]:text-xs md:justify-start md:px-3 md:text-sm`}
        >
          <Icon size={15} aria-hidden="true" />
          {label}
        </button>
      ))}
    </div>
  );
}

function CompactNotifications({
  notifications,
  unreadCount,
  loading,
  error,
  filter,
  setFilter,
  currentPage,
  setCurrentPage,
  selected,
  setSelected,
  read,
  readAll,
  unreadAll,
  markingUnread,
  confirmDelete,
  confirmClear,
  admin,
}) {
  const shown = notifications.filter((notification) =>
    filter === "Unread"
      ? !notification.isRead
      : filter === "Read"
        ? notification.isRead
        : true,
  );
  const totalPages = Math.max(1, Math.ceil(shown.length / ITEMS_PER_PAGE));
  const safePage = Math.min(currentPage, totalPages);
  const pageNotifications = shown.slice(
    (safePage - 1) * ITEMS_PER_PAGE,
    safePage * ITEMS_PER_PAGE,
  );
  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [currentPage, setCurrentPage, totalPages]);
  const open = async (notification) => {
    setSelected(notification);
    if (!notification.isRead) await read(notification._id);
  };
  const date = (value) => {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime())
      ? "Date unavailable"
      : parsed.toLocaleString(undefined, {
          year: "numeric",
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        });
  };
  const typeLabel = (notification) =>
    notification.type
      ? notification.type.charAt(0).toUpperCase() + notification.type.slice(1)
      : "Update";

  return (
    <div
      className={`${admin ? "w-full min-w-0 max-w-full space-y-5" : "w-full min-w-0 max-w-full space-y-6"}`}
    >
      <div className="flex min-w-0 flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="page-title">Notifications</h1>
          <p className="mt-2 text-sm text-slate-600">
            Stay updated with your consultation activities.
          </p>
        </div>
        <NotificationActions
          notifications={notifications}
          unreadCount={unreadCount}
          onReadAll={readAll}
          onUnreadAll={unreadAll}
          markingUnread={markingUnread}
          onClear={confirmClear}
          compact
        />
      </div>
      <div className="flex flex-wrap gap-2">
        {["All", "Unread", "Read"].map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => {
              setFilter(name);
              setCurrentPage(1);
            }}
            className={`h-9 rounded-lg px-3 text-sm font-semibold ${filter === name ? "bg-maroon-800 text-white" : "border border-slate-200 bg-white text-slate-700"}`}
          >
            {name}
          </button>
        ))}
      </div>
      {error && (
        <p className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </p>
      )}
      {loading ? (
        <p className="py-12 text-center font-semibold text-maroon-800">
          Loading notifications...
        </p>
      ) : shown.length === 0 ? (
        <NotificationEmptyState />
      ) : (
        <>
          <div className="responsive-table-shell responsive-table-scroll hidden md:block xl:overflow-visible">
            <table className="responsive-table min-w-[760px] text-xs xl:min-w-0 2xl:text-sm">
              <thead className="h-11 bg-maroon-800 text-[11px] uppercase tracking-wide text-white 2xl:text-xs">
                <tr>
                  <th className="w-[12%] px-3 py-3">Type</th>
                  <th className="w-[35%] px-3 py-3">Notification</th>
                  <th className="w-[21%] px-3 py-3">Date &amp; Time</th>
                  <th className="w-[10%] px-3 py-2 text-center">Status</th>
                  <th className="w-[22%] px-3 py-2">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {pageNotifications.map((notification) => (
                  <tr
                    key={notification._id}
                    className={`align-middle ${notification.isRead ? "bg-white" : "bg-gold-50"}`}
                  >
                    <td className="px-3 py-2 font-semibold text-maroon-800">
                      {typeLabel(notification)}
                    </td>
                    <td className="min-w-0 px-3 py-2">
                      <div className="flex min-w-0 items-center gap-2">
                        {!notification.isRead && (
                          <span className="h-2 w-2 shrink-0 rounded-full bg-gold-500" />
                        )}
                        <p
                          className={`truncate ${notification.isRead ? "font-medium" : "font-bold"}`}
                          title={notification.title}
                        >
                          {notification.title || "SOCConsult Notification"}
                        </p>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-slate-600">
                      {date(notification.createdAt)}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-center">
                        <StatusBadge
                          status={notification.isRead ? "Read" : "Unread"}
                          compact
                        />
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="table-action-group flex-nowrap whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => open(notification)}
                          className="btn-action-sm"
                        >
                          View
                        </button>
                        {!notification.isRead && (
                          <button
                            type="button"
                            onClick={() => read(notification._id)}
                            className="btn-action-sm"
                          >
                            Mark Read
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => confirmDelete(notification)}
                          className="btn-danger-action-sm"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="grid gap-3 md:hidden">
            {pageNotifications.map((notification) => (
              <article
                key={notification._id}
                className={`min-w-0 rounded-2xl border p-4 shadow-sm ${notification.isRead ? "border-slate-200 bg-white" : "border-gold-300 bg-gold-50"}`}
              >
                <div className="flex items-start gap-2">
                  {!notification.isRead && (
                    <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-gold-500" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p
                      className={`break-words ${notification.isRead ? "font-semibold" : "font-bold"}`}
                    >
                      {notification.title || "SOCConsult Notification"}
                    </p>
                    <p className="mt-1 text-xs font-semibold uppercase text-maroon-700">
                      {typeLabel(notification)} ·{" "}
                      {notification.isRead ? "Read" : "Unread"}
                    </p>
                    <p className="mt-2 text-xs text-slate-500">
                      {date(notification.createdAt)}
                    </p>
                  </div>
                </div>
                <div className="mt-4 flex min-w-0 flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => open(notification)}
                    className="btn-action-sm"
                  >
                    View
                  </button>
                  {!notification.isRead && (
                    <button
                      type="button"
                      onClick={() => read(notification._id)}
                      className="btn-action-sm"
                    >
                      Mark Read
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => confirmDelete(notification)}
                    className="btn-danger-action-sm"
                  >
                    Delete
                  </button>
                </div>
              </article>
            ))}
          </div>
          <div className="overflow-hidden rounded-b-2xl border border-t-0 border-slate-200">
            <Pagination
              currentPage={safePage}
              totalItems={shown.length}
              onPageChange={setCurrentPage}
              itemLabel="notifications"
              itemsPerPage={ITEMS_PER_PAGE}
            />
          </div>
        </>
      )}
      {selected && (
        <NotificationDetailsModal
          notification={{ ...selected, isRead: true }}
          date={date}
          typeLabel={typeLabel}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

function NotificationActions({
  notifications,
  unreadCount,
  onReadAll,
  onUnreadAll,
  markingUnread,
  onClear,
  compact = false,
}) {
  if (notifications.length === 0) return null;
  const hasRead = notifications.some((notification) => notification.isRead);
  return (
    <div className="grid w-full grid-cols-1 gap-2 min-[430px]:grid-cols-2 sm:flex sm:w-auto sm:flex-wrap sm:justify-end">
      <button
        type="button"
        onClick={onUnreadAll}
        disabled={!hasRead || markingUnread}
        className={`${compact ? "btn-action" : "btn-secondary"} w-full disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto`}
      >
        {markingUnread ? "Marking Unread..." : "Mark All as Unread"}
      </button>
      {unreadCount > 0 && (
        <button
          type="button"
          onClick={onReadAll}
          className={`${compact ? "btn-action" : "btn-secondary"} w-full sm:w-auto`}
        >
          Mark All as Read
        </button>
      )}
      {hasRead && (
        <button
          type="button"
          onClick={() => onClear("read")}
          className={`${compact ? "btn-action" : "btn-secondary"} w-full sm:w-auto`}
        >
          Clear Read
        </button>
      )}
      <button
        type="button"
        onClick={() => onClear("all")}
        className={`${compact ? "btn-danger-action" : "btn-danger-action"} w-full gap-2 sm:w-auto`}
      >
        <Trash2 size={16} aria-hidden="true" />
        Clear All
      </button>
    </div>
  );
}

function DeleteConfirmationModal({ action, loading, onCancel, onConfirm }) {
  const isDelete = action === "delete";
  const isRead = action === "read";
  const title = isDelete
    ? "Delete Notification?"
    : isRead
      ? "Clear Read Notifications?"
      : "Clear All Notifications?";
  const message = isDelete
    ? "Are you sure you want to delete this notification?"
    : isRead
      ? "This will permanently remove all of your read notifications."
      : "This will permanently remove all of your notifications.";
  const confirmLabel = isDelete
    ? "Delete"
    : isRead
      ? "Clear Read"
      : "Clear All";

  return (
    <ConfirmDialog
      open
      title={title}
      message={message}
      supportingText="This action cannot be undone."
      confirmLabel={confirmLabel}
      loadingLabel={isDelete ? "Deleting..." : "Clearing..."}
      loading={loading}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}

function NotificationEmptyState() {
  return (
    <>
      <div className="hidden max-w-full overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm md:block">
        <table className="w-full min-w-[800px] table-fixed text-left text-sm">
          <thead className="bg-maroon-800 text-white">
            <tr>
              <th className="w-[14%] px-4 py-3">Type</th>
              <th className="w-[34%] px-4 py-3">Notification</th>
              <th className="w-[22%] px-4 py-3">Date &amp; Time</th>
              <th className="w-[12%] px-4 py-3">Status</th>
              <th className="w-[18%] px-4 py-3">Action</th>
            </tr>
          </thead>
          <tbody>
            <tr className="bg-white">
              <td
                colSpan={5}
                className="px-4 py-10 text-center text-sm text-slate-500"
              >
                No notifications found.
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="md:hidden">
        <EmptyState
          title="No notifications found."
          text="Consultation updates will appear here."
        />
      </div>
    </>
  );
}

function NotificationDetailsModal({ notification, date, typeLabel, onClose }) {
  useEffect(() => {
    const previous = document.body.style.overflow;
    const escape = (event) => event.key === "Escape" && onClose();
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", escape);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", escape);
    };
  }, [onClose]);
  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex h-[100dvh] w-full min-w-0 items-center justify-center bg-black/50 p-3 sm:p-4"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="notification-details-title"
        onMouseDown={(event) => event.stopPropagation()}
        className="w-full max-w-xl rounded-2xl bg-white shadow-2xl"
      >
        <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4 sm:px-6">
          <h2
            id="notification-details-title"
            className="text-xl font-bold text-maroon-900"
          >
            Notification Details
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close notification details"
            className="rounded-lg p-1 text-slate-500 hover:bg-slate-100"
          >
            <X />
          </button>
        </header>
        <div className="space-y-5 px-5 py-5 sm:px-6">
          <dl className="grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-xs font-semibold uppercase text-slate-500">
                Type
              </dt>
              <dd className="mt-1 text-sm text-slate-800">
                {typeLabel(notification)}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase text-slate-500">
                Title
              </dt>
              <dd className="mt-1 text-sm font-semibold text-slate-800">
                {notification.title || "SOCConsult Notification"}
              </dd>
            </div>
          </dl>
          <div>
            <p className="text-xs font-semibold uppercase text-slate-500">
              Full Message
            </p>
            <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-800">
              {formatPersonNameInNotification(notification.message) ||
                "A SOCConsult activity was updated."}
            </p>
          </div>
          <dl className="grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-xs font-semibold uppercase text-slate-500">
                Date &amp; Time
              </dt>
              <dd className="mt-1 text-sm text-slate-800">
                {date(notification.createdAt)}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase text-slate-500">
                Status
              </dt>
              <dd className="mt-1 text-sm text-slate-800">Read</dd>
            </div>
          </dl>
        </div>
        <footer className="flex justify-end border-t border-slate-200 px-4 py-4 sm:px-6">
          <button
            type="button"
            onClick={onClose}
            className="btn-secondary w-full sm:w-auto"
          >
            Close
          </button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
