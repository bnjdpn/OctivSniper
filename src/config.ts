import { join } from "path";
import type { OctivConfig, SlotConfig, DayOfWeek } from "./types";

const CONFIG_PATH = join(import.meta.dir, "..", "config.json");

const DEFAULT_CONFIG: OctivConfig = {
  auth: {
    email: "",
    jwt: "",
    userId: 0,
    tenantId: 0,
    locationId: 0,
  },
  advanceBookingDays: 4,
  slots: [],
  retryIntervalMs: 500,
  maxRetries: 20,
};

export async function loadConfig(): Promise<OctivConfig> {
  try {
    const file = Bun.file(CONFIG_PATH);
    if (await file.exists()) {
      const data = await file.json();
      return { ...DEFAULT_CONFIG, ...data };
    }
  } catch {
    // Config doesn't exist or is invalid, return default
  }
  return { ...DEFAULT_CONFIG };
}

export async function saveConfig(config: OctivConfig): Promise<void> {
  await Bun.write(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n");
}

export function addSlot(
  config: OctivConfig,
  day: DayOfWeek,
  time: string,
  className: string
): OctivConfig {
  const slot: SlotConfig = { day, time, className };
  return { ...config, slots: [...config.slots, slot] };
}

export function removeSlot(config: OctivConfig, index: number): OctivConfig {
  const slots = config.slots.filter((_, i) => i !== index);
  return { ...config, slots };
}

export function isValidDay(day: string): day is DayOfWeek {
  return [
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
  ].includes(day.toLowerCase());
}

export function isValidTime(time: string): boolean {
  return /^\d{2}:\d{2}$/.test(time);
}
