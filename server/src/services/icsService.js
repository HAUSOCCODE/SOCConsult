export function foldIcsLine(line) {
  let result = "", width = 0;
  for (const character of line) {
    const bytes = Buffer.byteLength(character, "utf8");
    if (width + bytes > 75) { result += "\r\n "; width = 1; }
    result += character; width += bytes;
  }
  return result;
}
export const validCalendarSchedule = a => a.startAt != null && a.endAt != null &&
  Number.isFinite(+new Date(a.startAt)) && Number.isFinite(+new Date(a.endAt)) &&
  +new Date(a.endAt) > +new Date(a.startAt);
export const canExportCalendar = (a, now = new Date()) => a.status === "Confirmed" &&
  validCalendarSchedule(a) && +new Date(now) < +new Date(a.endAt);
export function safeCalendarMeetingLink(value) {
  if (typeof value !== "string" || /[\s\x00-\x1f\x7f]/u.test(value)) return "";
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && url.hostname && !url.username && !url.password ? value : "";
  } catch { return ""; }
}

const MANILA_TIME_ZONE = "Asia/Manila";

export const escapeIcsText = (value = "") =>
  String(value)
    .replaceAll("\\", "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replaceAll(",", "\\,")
    .replaceAll(";", "\\;");

export const toIcsUtcTimestamp = (value) => {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()))
    throw new TypeError("A valid calendar timestamp is required.");
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
};

export const manilaDateKey = (value) => {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()))
    throw new TypeError("A valid consultation start time is required.");
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: MANILA_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(date)
      .filter(({ type }) => type !== "literal")
      .map(({ type, value: part }) => [type, part]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
};

export const consultationIcsFilename = (startAt) =>
  `SOCConsult-Consultation-${manilaDateKey(startAt)}.ics`;

export function generateConsultationIcs(appointment, now = new Date()) {
  const startAt = new Date(appointment.startAt);
  const endAt = new Date(appointment.endAt);
  if (
    !validCalendarSchedule(appointment)
  )
    throw new TypeError("The consultation schedule is invalid.");

  const providerName = appointment.faculty?.name || "Consultation Provider";
  const subject = appointment.subject || "Consultation";
  const mode = appointment.consultationMode || "Not specified";
  const location =
    mode === "Face-to-Face"
      ? appointment.location || "Location to be confirmed"
      : appointment.meetingPlatform || "Online consultation";
  const link = mode === "Online" ? safeCalendarMeetingLink(appointment.meetingLink) : "";
  const description = [
    "SOCConsult consultation.",
    `Subject or Course: ${subject}`,
    `Provider: ${providerName}`,
    `Mode: ${mode}`,
    ...(link ? [`Meeting link: ${link}`] : []),
    "One-way snapshot; external calendar changes do not update SOCConsult.",
  ].join("\n");

  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//SOCConsult//Student Consultation//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${escapeIcsText(`${appointment._id}@socconsult`)}`,
    `DTSTAMP:${toIcsUtcTimestamp(now)}`,
    `DTSTART:${toIcsUtcTimestamp(startAt)}`,
    `DTEND:${toIcsUtcTimestamp(endAt)}`,
    `SUMMARY:${escapeIcsText(`SOCConsult Consultation — ${subject}`)}`,
    `DESCRIPTION:${escapeIcsText(description)}`,
    `LOCATION:${escapeIcsText(location)}`,
    "STATUS:CONFIRMED",
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].map(foldIcsLine).join("\r\n");
}
