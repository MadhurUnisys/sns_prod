// Scheduled delivery windows, all in India Standard Time (UTC+05:30, no daylight saving).
// Edit DELIVERY_SLOTS to change the windows; DELIVERY_SLOT_DAYS_AHEAD sets how far ahead customers may book.
export const DELIVERY_TIME_ZONE = "Asia/Kolkata";
const UTC_OFFSET_MINUTES = 330;
const DAY_MS = 86_400_000;

export const DELIVERY_SLOTS = [
  { key: "0700-0900", label: "7:00 – 9:00 AM", start: "07:00", end: "09:00" },
  { key: "0900-1200", label: "9:00 AM – 12:00 PM", start: "09:00", end: "12:00" },
  { key: "1600-1900", label: "4:00 – 7:00 PM", start: "16:00", end: "19:00" },
  { key: "1900-2100", label: "7:00 – 9:00 PM", start: "19:00", end: "21:00" },
];

const daysAhead = () => {
  const value = Number(process.env.DELIVERY_SLOT_DAYS_AHEAD ?? 2);
  return Number.isSafeInteger(value) && value >= 0 && value <= 30 ? value : 2;
};

const isCalendarDate = (date) =>
  typeof date === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(date) &&
  !Number.isNaN(Date.parse(`${date}T00:00:00Z`)) &&
  new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;

const instant = (date, time) => {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  return new Date(Date.UTC(year, month - 1, day, hour, minute) - UTC_OFFSET_MINUTES * 60_000);
};

// The calendar date in India for a given instant, as YYYY-MM-DD.
export const localDate = (at = new Date()) =>
  new Date(at.getTime() + UTC_OFFSET_MINUTES * 60_000).toISOString().slice(0, 10);

// Slots for one date that have not started yet; [] outside today..today+daysAhead; null for an invalid date.
export const bookableSlots = (date, now = new Date()) => {
  if (!isCalendarDate(date)) return null;
  if (date < localDate(now) || date > localDate(new Date(now.getTime() + daysAhead() * DAY_MS))) return [];
  return DELIVERY_SLOTS
    .map((slot) => ({ id: `${date}_${slot.key}`, date, label: slot.label, start: instant(date, slot.start), end: instant(date, slot.end) }))
    .filter((slot) => slot.start > now);
};

export const allBookableSlots = (now = new Date()) =>
  Array.from({ length: daysAhead() + 1 }, (_, offset) => localDate(new Date(now.getTime() + offset * DAY_MS)))
    .flatMap((date) => bookableSlots(date, now));

export const findBookableSlot = (slotId, now = new Date()) => {
  if (typeof slotId !== "string") return null;
  const [date] = slotId.split("_");
  return bookableSlots(date, now)?.find((slot) => slot.id === slotId) ?? null;
};
