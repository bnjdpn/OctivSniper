import type { ClassDate, BookingResult } from "./types";

const BASE_URL = "https://app.octivfitness.com";

const DEFAULT_HEADERS = {
  "X-CamelCase": "true",
  Accept: "application/json",
  "Content-Type": "application/json",
};

function authHeaders(jwt: string) {
  return {
    ...DEFAULT_HEADERS,
    Authorization: `Bearer ${jwt}`,
  };
}

export async function login(
  email: string,
  password: string
): Promise<{ jwt: string }> {
  const res = await fetch(`${BASE_URL}/api/login`, {
    method: "POST",
    headers: DEFAULT_HEADERS,
    body: JSON.stringify({ email, password }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Login failed (${res.status}): ${body}`);
  }

  const data = await res.json();
  return { jwt: data.token || data.jwt || data.accessToken };
}

export async function getUserInfo(
  jwt: string
): Promise<{ userId: number; tenantId: number; locationId: number }> {
  const res = await fetch(`${BASE_URL}/api/users/me`, {
    headers: authHeaders(jwt),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`getUserInfo failed (${res.status}): ${body}`);
  }

  const data = await res.json();
  const user = data.data || data;

  return {
    userId: user.id,
    tenantId: user.tenantId,
    locationId: user.locationId || user.locations?.[0]?.id,
  };
}

export async function getClassDates(
  jwt: string,
  tenantId: number,
  locationId: number,
  date: string // YYYY-MM-DD
): Promise<ClassDate[]> {
  const params = new URLSearchParams({
    "filter[tenantId]": tenantId.toString(),
    "filter[locationId]": locationId.toString(),
    "filter[between]": `${date},${date}`,
    "filter[isSession]": "false",
    perPage: "50",
  });

  const res = await fetch(`${BASE_URL}/api/class-dates?${params}`, {
    headers: authHeaders(jwt),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`getClassDates failed (${res.status}): ${body}`);
  }

  const data = await res.json();
  return (data.data || data) as ClassDate[];
}

export async function bookClass(
  jwt: string,
  classDateId: number,
  userId: number
): Promise<BookingResult> {
  const res = await fetch(`${BASE_URL}/api/class-bookings`, {
    method: "POST",
    headers: authHeaders(jwt),
    body: JSON.stringify({ classDateId, userId }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`bookClass failed (${res.status}): ${body}`);
  }

  const data = await res.json();
  return (data.data || data) as BookingResult;
}

export async function cancelBooking(
  jwt: string,
  bookingId: number
): Promise<void> {
  const res = await fetch(`${BASE_URL}/api/class-bookings/${bookingId}/cancel`, {
    method: "PUT",
    headers: authHeaders(jwt),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`cancelBooking failed (${res.status}): ${body}`);
  }
}

export function findClassByNameAndTime(
  classes: ClassDate[],
  className: string,
  time: string // "HH:MM"
): ClassDate | undefined {
  return classes.find((c) => {
    const classTime = new Date(c.startAt);
    const hhmm = `${classTime.getHours().toString().padStart(2, "0")}:${classTime.getMinutes().toString().padStart(2, "0")}`;
    const nameMatch = c.className.toLowerCase().includes(className.toLowerCase());
    return nameMatch && hhmm === time;
  });
}
