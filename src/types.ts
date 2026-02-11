export type DayOfWeek =
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday"
  | "sunday";

export interface SlotConfig {
  day: DayOfWeek;
  time: string; // "HH:MM" format
  className: string; // e.g. "WOD", "GYMNASTICS"
}

export interface AuthConfig {
  email: string;
  jwt: string;
  refreshToken: string;
  expiresAt: number; // timestamp ms
  userId: number;
  tenantId: number;
  locationId: number;
}

export interface OctivConfig {
  auth: AuthConfig;
  advanceBookingDays: number;
  slots: SlotConfig[];
  retryIntervalMs: number;
  maxRetries: number;
}

export interface ClassDate {
  id: number;
  date: string; // "YYYY-MM-DD"
  name: string; // e.g. "WOD"
  startTime: string; // "HH:MM:SS"
  endTime: string; // "HH:MM:SS"
  limit: number;
  classId: number;
  bookings: any[];
  // Kept for compatibility
  className?: string;
  startAt?: string;
}

export interface BookingResult {
  id: number;
  statusId: number;
  status: { id: number; name: string };
}

export interface ScheduledBooking {
  slot: SlotConfig;
  classDate: Date;
  openingTime: Date;
  attemptTime: Date; // 30s before opening
}
