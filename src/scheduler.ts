import type { SlotConfig, OctivConfig, ScheduledBooking, ClassDate } from "./types";
import { getClassDates, bookClass, findClassByNameAndTime } from "./api";

const DAY_MAP: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

const ANTICIPATION_MS = 30_000; // Start 30s before opening

function log(msg: string) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] ${msg}`);
}

/**
 * Find the next occurrence of a given day/time from now.
 */
export function getNextClassDate(day: string, time: string): Date {
  const now = new Date();
  const [hours, minutes] = time.split(":").map(Number);
  const targetDay = DAY_MAP[day.toLowerCase()];

  const result = new Date(now);
  result.setHours(hours, minutes, 0, 0);

  // Find the next occurrence of the target day
  const currentDay = now.getDay();
  let daysUntil = targetDay - currentDay;

  if (daysUntil < 0) {
    daysUntil += 7;
  } else if (daysUntil === 0 && result <= now) {
    daysUntil = 7; // Already passed today, schedule next week
  }

  result.setDate(result.getDate() + daysUntil);
  return result;
}

/**
 * Calculate when the booking window opens.
 * Bookings open `advanceDays` before the class, at the class end time.
 * We assume a 1-hour class duration by default.
 */
export function calculateOpeningTime(
  classDate: Date,
  advanceDays: number,
  classDurationMinutes: number = 60
): Date {
  const opening = new Date(classDate);
  opening.setDate(opening.getDate() - advanceDays);
  opening.setMinutes(opening.getMinutes() + classDurationMinutes);
  return opening;
}

/**
 * Get all scheduled bookings with their opening times.
 */
export function getScheduledBookings(config: OctivConfig): ScheduledBooking[] {
  return config.slots.map((slot) => {
    const classDate = getNextClassDate(slot.day, slot.time);
    const openingTime = calculateOpeningTime(classDate, config.advanceBookingDays);
    const attemptTime = new Date(openingTime.getTime() - ANTICIPATION_MS);

    return { slot, classDate, openingTime, attemptTime };
  });
}

/**
 * Pre-fetch the classDateId before the booking window opens.
 */
async function prefetchClassDateId(
  config: OctivConfig,
  slot: SlotConfig,
  targetDate: Date
): Promise<ClassDate | undefined> {
  const dateStr = targetDate.toISOString().split("T")[0];
  log(`Pre-fetching classes for ${dateStr}...`);

  try {
    const classes = await getClassDates(
      config.auth.jwt,
      config.auth.tenantId,
      config.auth.locationId,
      dateStr
    );
    const match = findClassByNameAndTime(classes, slot.className, slot.time);
    if (match) {
      const booked = match.bookings?.length ?? 0;
      log(`Found class: ${match.name} (id=${match.id}) - ${booked}/${match.limit} booked`);
    } else {
      log(`No matching class found for ${slot.className} at ${slot.time}`);
    }
    return match;
  } catch (err) {
    log(`Pre-fetch failed: ${err}`);
    return undefined;
  }
}

/**
 * Attempt to book a class with retries.
 */
async function attemptBooking(
  config: OctivConfig,
  slot: SlotConfig,
  targetDate: Date,
  prefetchedClass?: ClassDate
): Promise<boolean> {
  const dateStr = targetDate.toISOString().split("T")[0];

  for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
    try {
      // Use prefetched classDateId or fetch fresh
      let classInfo = prefetchedClass;
      if (!classInfo) {
        const classes = await getClassDates(
          config.auth.jwt,
          config.auth.tenantId,
          config.auth.locationId,
          dateStr
        );
        classInfo = findClassByNameAndTime(classes, slot.className, slot.time);
      }

      if (!classInfo) {
        log(`Attempt ${attempt}/${config.maxRetries}: Class not found, retrying...`);
        await Bun.sleep(config.retryIntervalMs);
        continue;
      }

      const booked = classInfo.bookings?.length ?? 0;
      if (booked >= classInfo.limit) {
        log(`Attempt ${attempt}/${config.maxRetries}: Class is full (${booked}/${classInfo.limit})!`);
        return false;
      }

      log(`Attempt ${attempt}/${config.maxRetries}: Booking class ${classInfo.id}...`);
      const result = await bookClass(config.auth.jwt, classInfo.id, config.auth.userId);
      log(`SUCCESS! Booked ${slot.className} ${slot.day} ${slot.time} (booking id=${result.id})`);
      return true;
    } catch (err: any) {
      const msg = err?.message || String(err);
      if (msg.includes("advance") || msg.includes("early") || msg.includes("not yet")) {
        log(`Attempt ${attempt}/${config.maxRetries}: Too early, retrying in ${config.retryIntervalMs}ms...`);
      } else {
        log(`Attempt ${attempt}/${config.maxRetries}: Error - ${msg}`);
      }
      // Clear prefetched to force re-fetch on next attempt
      prefetchedClass = undefined;
      await Bun.sleep(config.retryIntervalMs);
    }
  }

  log(`FAILED: Could not book ${slot.className} ${slot.day} ${slot.time} after ${config.maxRetries} attempts`);
  return false;
}

/**
 * Schedule a single booking.
 */
export function scheduleBooking(
  scheduled: ScheduledBooking,
  config: OctivConfig,
  onComplete?: () => void
): void {
  const { slot, classDate, openingTime, attemptTime } = scheduled;
  const now = new Date();
  const msUntilAttempt = attemptTime.getTime() - now.getTime();

  if (msUntilAttempt < 0) {
    log(`Booking window for ${slot.className} ${slot.day} ${slot.time} has already passed, scheduling next week`);
    // Schedule for next week
    const nextClassDate = new Date(classDate);
    nextClassDate.setDate(nextClassDate.getDate() + 7);
    const nextOpening = calculateOpeningTime(nextClassDate, config.advanceBookingDays);
    const nextAttempt = new Date(nextOpening.getTime() - ANTICIPATION_MS);
    const nextScheduled: ScheduledBooking = {
      slot,
      classDate: nextClassDate,
      openingTime: nextOpening,
      attemptTime: nextAttempt,
    };
    scheduleBooking(nextScheduled, config, onComplete);
    return;
  }

  log(
    `Scheduled: ${slot.className} ${slot.day} ${slot.time} → ` +
      `class on ${classDate.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })} | ` +
      `opens ${openingTime.toLocaleString("fr-FR")} | ` +
      `attempt at ${attemptTime.toLocaleString("fr-FR")} ` +
      `(in ${formatDuration(msUntilAttempt)})`
  );

  // Pre-fetch 2 minutes before attempt time
  const prefetchMs = msUntilAttempt - 120_000;
  let prefetchedClass: ClassDate | undefined;

  if (prefetchMs > 0) {
    setTimeout(async () => {
      prefetchedClass = await prefetchClassDateId(config, slot, classDate);
    }, prefetchMs);
  }

  // Schedule the actual booking attempt
  setTimeout(async () => {
    log(`Starting booking attempts for ${slot.className} ${slot.day} ${slot.time}...`);

    // If we haven't prefetched yet, do it now
    if (!prefetchedClass) {
      prefetchedClass = await prefetchClassDateId(config, slot, classDate);
    }

    const success = await attemptBooking(config, slot, classDate, prefetchedClass);

    if (success || !success) {
      // Schedule next week regardless
      const nextClassDate = new Date(classDate);
      nextClassDate.setDate(nextClassDate.getDate() + 7);
      const nextOpening = calculateOpeningTime(nextClassDate, config.advanceBookingDays);
      const nextAttempt = new Date(nextOpening.getTime() - ANTICIPATION_MS);
      const nextScheduled: ScheduledBooking = {
        slot,
        classDate: nextClassDate,
        openingTime: nextOpening,
        attemptTime: nextAttempt,
      };
      scheduleBooking(nextScheduled, config, onComplete);
    }

    onComplete?.();
  }, msUntilAttempt);
}

/**
 * Run the scheduler for all configured slots.
 */
export function runScheduler(config: OctivConfig): void {
  if (config.slots.length === 0) {
    log("No slots configured. Use 'octiv add <day> <time> <className>' to add one.");
    return;
  }

  log(`OctivSniper started - monitoring ${config.slots.length} slot(s)`);
  log(`Advance booking: ${config.advanceBookingDays} days | Retry: ${config.retryIntervalMs}ms x${config.maxRetries}`);
  log("---");

  const scheduled = getScheduledBookings(config);
  for (const s of scheduled) {
    scheduleBooking(s, config);
  }

  log("---");
  log("Scheduler running. Press Ctrl+C to stop.");
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}
