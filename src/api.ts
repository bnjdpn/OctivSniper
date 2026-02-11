import type { ClassDate, BookingResult } from "./types";

const BASE_URL = "https://api.octivfitness.com";

const DEFAULT_HEADERS = {
  "X-CamelCase": "true",
  Accept: "application/json, text/plain, */*",
  "Content-Type": "application/json",
  "bypass-tunnel-reminder": "*",
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
    body: JSON.stringify({ username: email, password }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Login failed (${res.status}): ${body}`);
  }

  const data = await res.json();
  return { jwt: data.accessToken };
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

  return {
    userId: data.id,
    tenantId: data.userTenants[0].tenantId,
    locationId: data.userTenants[0].tenant.locations[0].id,
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
  return data as BookingResult;
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
    // startTime is "HH:MM:SS" format, name is the class name
    const hhmm = (c as any).startTime?.slice(0, 5);
    const name = (c as any).name || c.className;
    const nameMatch = name?.toLowerCase().includes(className.toLowerCase());
    return nameMatch && hhmm === time;
  });
}
