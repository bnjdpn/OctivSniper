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
  classId: number;
  className: string;
  startAt: string; // ISO datetime
  endAt: string; // ISO datetime
  availableSpots: number;
  totalSpots: number;
  bookings: number;
  isFull: boolean;
  isBookable: boolean;
}

export interface BookingResult {
  id: number;
  classDateId: number;
  userId: number;
  status: string;
}

export interface ScheduledBooking {
  slot: SlotConfig;
  classDate: Date;
  openingTime: Date;
  attemptTime: Date; // 30s before opening
}
