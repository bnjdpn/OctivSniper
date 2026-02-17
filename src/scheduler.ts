import type { SlotConfig, OctivConfig, ScheduledBooking, ClassDate } from "./types";
import { getClassDates, bookClass, findClassByNameAndTime, refreshAuth } from "./api";
import { saveConfig } from "./config";

const DAY_MAP: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

const ANTICIPATION_MS = 30_000;
const TOKEN_REFRESH_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000; // 7 days before expiry

function log(msg: string) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] ${msg}`);
}

export function getNextClassDate(day: string, time: string): Date {
  const now = new Date();
  const [hours, minutes] = time.split(":").map(Number);
  const targetDay = DAY_MAP[day.toLowerCase()];

  const result = new Date(now);
  result.setHours(hours, minutes, 0, 0);

  const currentDay = now.getDay();
  let daysUntil = targetDay - currentDay;

  if (daysUntil < 0) {
    daysUntil += 7;
  } else if (daysUntil === 0 && result <= now) {
    daysUntil = 7;
  }

  result.setDate(result.getDate() + daysUntil);
  return result;
}

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

export function getScheduledBookings(config: OctivConfig): ScheduledBooking[] {
  return config.slots.map((slot) => {
    const classDate = getNextClassDate(slot.day, slot.time);
    const openingTime = calculateOpeningTime(classDate, config.advanceBookingDays);
    const attemptTime = new Date(openingTime.getTime() - ANTICIPATION_MS);
    return { slot, classDate, openingTime, attemptTime };
  });
}

async function refreshTokenIfNeeded(config: OctivConfig): Promise<void> {
  if (!config.auth.expiresAt || !config.auth.refreshToken) return;
  if (Date.now() < config.auth.expiresAt - TOKEN_REFRESH_THRESHOLD_MS) return;

  log("Token expires soon, attempting refresh...");
  try {
    const result = await refreshAuth(config.auth.refreshToken);
    config.auth.jwt = result.jwt;
    config.auth.refreshToken = result.refreshToken;
    config.auth.expiresAt = result.expiresAt;
    await saveConfig(config);
    log("Token refreshed successfully");
  } catch (err) {
    log(`Token refresh failed: ${err}. Re-login may be required.`);
  }
}

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

async function attemptBooking(
  config: OctivConfig,
  slot: SlotConfig,
  targetDate: Date,
  prefetchedClass?: ClassDate
): Promise<boolean> {
  const dateStr = targetDate.toISOString().split("T")[0];
  let realAttempts = 0; // only counts once window is open
  let earlyAttempts = 0;

  while (realAttempts < config.maxRetries) {
    try {
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
        realAttempts++;
        log(`Attempt ${realAttempts}/${config.maxRetries}: Class not found, retrying...`);
        await Bun.sleep(config.retryIntervalMs);
        continue;
      }

      // Don't check bookings count — just fire the booking request immediately.
      // The server is the source of truth; checking locally wastes time.
      log(`Booking class ${classInfo.id}...`);
      const result = await bookClass(config.auth.jwt, classInfo.id, config.auth.userId);
      log(`SUCCESS! Booked ${slot.className} ${slot.day} ${slot.time} (booking id=${result.id})`);
      return true;
    } catch (err: any) {
      const msg = err?.message || String(err);
      const isTooEarly = msg.includes("advance") || msg.includes("early") || msg.includes("not yet") || msg.includes("far");

      if (isTooEarly) {
        // Too early — does NOT count against maxRetries
        // Keep prefetchedClass — classId doesn't change, skip the extra GET
        // Throttle to avoid 429 rate-limit before window opens
        earlyAttempts++;
        if (earlyAttempts % 50 === 0) {
          log(`Waiting for window to open... (${earlyAttempts} early attempts)`);
        }
        await Bun.sleep(250);
      } else if (msg.includes("full") || msg.includes("limit") || msg.includes("complet")) {
        realAttempts++;
        log(`Attempt ${realAttempts}/${config.maxRetries}: Full — ${msg}`);
        prefetchedClass = undefined;
        // Keep retrying in case someone cancels, but slightly slower
        await Bun.sleep(config.retryIntervalMs * 5);
      } else {
        realAttempts++;
        log(`Attempt ${realAttempts}/${config.maxRetries}: Error — ${msg}`);
        prefetchedClass = undefined;
        await Bun.sleep(config.retryIntervalMs);
      }
    }
  }

  log(`FAILED: Could not book ${slot.className} ${slot.day} ${slot.time} after ${realAttempts} attempts (${earlyAttempts} early)`);
  return false;
}

function scheduleNext(slot: SlotConfig, classDate: Date, config: OctivConfig) {
  const nextClassDate = new Date(classDate);
  nextClassDate.setDate(nextClassDate.getDate() + 7);
  const nextOpening = calculateOpeningTime(nextClassDate, config.advanceBookingDays);
  const nextAttempt = new Date(nextOpening.getTime() - ANTICIPATION_MS);
  scheduleBooking(
    { slot, classDate: nextClassDate, openingTime: nextOpening, attemptTime: nextAttempt },
    config
  );
}

export function scheduleBooking(
  scheduled: ScheduledBooking,
  config: OctivConfig
): void {
  const { slot, classDate, openingTime, attemptTime } = scheduled;
  const now = new Date();
  const msUntilAttempt = attemptTime.getTime() - now.getTime();

  if (msUntilAttempt < 0) {
    log(`Booking window for ${slot.className} ${slot.day} ${slot.time} already passed, scheduling next week`);
    scheduleNext(slot, classDate, config);
    return;
  }

  log(
    `Scheduled: ${slot.className} ${slot.day} ${slot.time} → ` +
      `class ${classDate.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })} | ` +
      `opens ${openingTime.toLocaleString("fr-FR")} | ` +
      `attempt ${attemptTime.toLocaleString("fr-FR")} ` +
      `(in ${formatDuration(msUntilAttempt)})`
  );

  // Pre-fetch 2 minutes before
  const prefetchMs = msUntilAttempt - 120_000;
  let prefetchedClass: ClassDate | undefined;

  if (prefetchMs > 0) {
    setTimeout(async () => {
      await refreshTokenIfNeeded(config);
      prefetchedClass = await prefetchClassDateId(config, slot, classDate);
    }, prefetchMs);
  }

  // Schedule booking attempt
  setTimeout(async () => {
    await refreshTokenIfNeeded(config);

    log(`Starting booking attempts for ${slot.className} ${slot.day} ${slot.time}...`);

    if (!prefetchedClass) {
      prefetchedClass = await prefetchClassDateId(config, slot, classDate);
    }

    await attemptBooking(config, slot, classDate, prefetchedClass);
    scheduleNext(slot, classDate, config);
  }, msUntilAttempt);
}

export function runScheduler(config: OctivConfig): void {
  if (config.slots.length === 0) {
    log("No slots configured.");
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
