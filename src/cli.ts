import { loadConfig, saveConfig, addSlot, removeSlot, isValidDay, isValidTime } from "./config";
import { login, getUserInfo, getClassDates, refreshAuth, findClassByNameAndTime } from "./api";
import { getScheduledBookings, runScheduler } from "./scheduler";
import { bold, dim, green, yellow, red, cyan, input, password, multiSelect, spinner } from "./ui";
import type { DayOfWeek, OctivConfig, SlotConfig, ClassDate } from "./types";

const DAYS_EN = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const DAYS_FR_SHORT = ["dim", "lun", "mar", "mer", "jeu", "ven", "sam"];

// ─── Interactive mode ──────────────────────────────────────────────

export async function interactiveMode(): Promise<void> {
  console.log();
  console.log(bold("  OctivSniper"));

  // 1. Ensure auth
  let config = await ensureAuthenticated(await loadConfig());

  // 2. Fetch classes for the week
  const s = spinner("Chargement des cours de la semaine...");
  const classes = await fetchWeekClasses(config);
  s.stop(`${classes.length} cours trouves`);

  if (classes.length === 0) {
    console.log(yellow("  Aucun cours trouve pour les 7 prochains jours."));
    return;
  }

  // 3. Build options and show multi-select
  const options = buildClassOptions(classes, config);
  const selectedSlots = await multiSelect<SlotConfig>({
    message: "Selectionne les cours a reserver automatiquement :",
    options,
  });

  // 4. Save
  config = { ...config, slots: selectedSlots };
  await saveConfig(config);

  if (selectedSlots.length === 0) {
    console.log();
    console.log(yellow("  Aucun cours selectionne. Config sauvegardee."));
    return;
  }

  // 5. Show next bookings
  console.log();
  const scheduled = getScheduledBookings(config);
  scheduled.sort((a, b) => a.attemptTime.getTime() - b.attemptTime.getTime());

  for (const sb of scheduled) {
    const classDateStr = sb.classDate.toLocaleDateString("fr-FR", {
      weekday: "long",
      day: "numeric",
      month: "long",
    });
    const attemptStr = sb.attemptTime.toLocaleString("fr-FR");
    const msUntil = sb.attemptTime.getTime() - Date.now();
    const relative = msUntil > 0 ? formatDuration(msUntil) : "imminent";
    console.log(
      dim(`  ${sb.slot.className} ${sb.slot.day} ${sb.slot.time}`) +
        ` → cours ${classDateStr}` +
        dim(` | booking ${attemptStr} (${relative})`)
    );
  }

  // 6. Launch scheduler
  console.log();
  runScheduler(config);
}

// ─── Auth ──────────────────────────────────────────────────────────

async function ensureAuthenticated(config: OctivConfig): Promise<OctivConfig> {
  // Check if we have a valid token
  if (config.auth.jwt) {
    const expired = config.auth.expiresAt > 0 && Date.now() > config.auth.expiresAt;

    if (!expired) {
      try {
        await getUserInfo(config.auth.jwt);
        console.log(green(`  ✓ Connecte : ${config.auth.email}`));
        return config;
      } catch {
        // Token invalid
      }
    }

    // Try refresh
    if (config.auth.refreshToken) {
      try {
        const result = await refreshAuth(config.auth.refreshToken);
        config.auth.jwt = result.jwt;
        config.auth.refreshToken = result.refreshToken;
        config.auth.expiresAt = result.expiresAt;
        await saveConfig(config);
        console.log(green(`  ✓ Token renouvele pour ${config.auth.email}`));
        return config;
      } catch {
        // Refresh failed
      }
    }
  }

  // Need login
  console.log(dim("  Connexion requise"));
  console.log();
  const email = await input("  Email: ");
  const pw = await password("  Mot de passe: ");

  const s = spinner("Connexion...");
  try {
    const loginResult = await login(email, pw);
    const userInfo = await getUserInfo(loginResult.jwt);

    config.auth = {
      email,
      jwt: loginResult.jwt,
      refreshToken: loginResult.refreshToken,
      expiresAt: loginResult.expiresAt,
      userId: userInfo.userId,
      tenantId: userInfo.tenantId,
      locationId: userInfo.locationId,
    };
    await saveConfig(config);
    s.stop(`Connecte : ${email}`);
    return config;
  } catch (err) {
    s.stop();
    console.error(red(`  Erreur de connexion : ${err}`));
    process.exit(1);
  }
}

// ─── Fetch & build options ─────────────────────────────────────────

async function fetchWeekClasses(config: OctivConfig): Promise<ClassDate[]> {
  const dates: string[] = [];
  const today = new Date();
  for (let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    dates.push(d.toISOString().split("T")[0]);
  }

  const results = await Promise.all(
    dates.map((date) =>
      getClassDates(config.auth.jwt, config.auth.tenantId, config.auth.locationId, date).catch(
        () => [] as ClassDate[]
      )
    )
  );

  return results.flat();
}

function buildClassOptions(
  classes: ClassDate[],
  config: OctivConfig
): { label: string; value: SlotConfig; hint: string; selected: boolean }[] {
  // Sort by date then time
  classes.sort((a, b) => {
    const d = a.date.localeCompare(b.date);
    return d !== 0 ? d : a.startTime.localeCompare(b.startTime);
  });

  return classes.map((c) => {
    const [y, m, d] = c.date.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    const dayIdx = dt.getDay();
    const dayEn = DAYS_EN[dayIdx] as DayOfWeek;
    const dayFr = DAYS_FR_SHORT[dayIdx];
    const dateStr = `${d.toString().padStart(2, "0")}/${m.toString().padStart(2, "0")}`;
    const time = c.startTime.slice(0, 5);
    const name = c.name || "?";
    const booked = c.bookings?.length ?? 0;

    const isConfigured = config.slots.some(
      (s) =>
        s.day === dayEn &&
        s.time === time &&
        s.className.toLowerCase() === name.toLowerCase()
    );

    const label = `${dayFr} ${dateStr}  ${time}  ${name.padEnd(16)}`;
    const hint = `${booked}/${c.limit}`;

    return {
      label,
      value: { day: dayEn, time, className: name } as SlotConfig,
      hint,
      selected: isConfigured,
    };
  });
}

// ─── Legacy subcommands ────────────────────────────────────────────

export async function handleLogin(): Promise<void> {
  const config = await loadConfig();

  const email = await input("Email: ");
  const pw = await password("Password: ");

  console.log("Logging in...");
  try {
    const loginResult = await login(email, pw);
    console.log("Login successful! Fetching user info...");

    const userInfo = await getUserInfo(loginResult.jwt);
    config.auth = {
      email,
      jwt: loginResult.jwt,
      refreshToken: loginResult.refreshToken,
      expiresAt: loginResult.expiresAt,
      userId: userInfo.userId,
      tenantId: userInfo.tenantId,
      locationId: userInfo.locationId,
    };

    await saveConfig(config);
    console.log(
      `Saved! userId=${config.auth.userId}, tenantId=${config.auth.tenantId}, locationId=${config.auth.locationId}`
    );
  } catch (err) {
    console.error(`Login failed: ${err}`);
    process.exit(1);
  }
}

export async function handleAdd(args: string[]): Promise<void> {
  if (args.length < 3) {
    console.error("Usage: octiv add <day> <time> <className>");
    process.exit(1);
  }

  const [day, time, ...rest] = args;
  const className = rest.join(" ");

  if (!isValidDay(day)) {
    console.error(`Invalid day: ${day}`);
    process.exit(1);
  }
  if (!isValidTime(time)) {
    console.error(`Invalid time format: ${time} (expected HH:MM)`);
    process.exit(1);
  }

  const config = await loadConfig();
  const updated = addSlot(config, day.toLowerCase() as DayOfWeek, time, className);
  await saveConfig(updated);
  console.log(`Added: ${className} on ${day} at ${time}`);
}

export async function handleList(): Promise<void> {
  const config = await loadConfig();
  if (config.slots.length === 0) {
    console.log("No slots configured. Run 'octiv' to set them up interactively.");
    return;
  }
  console.log("Configured slots:");
  config.slots.forEach((slot, i) => {
    console.log(`  [${i}] ${slot.className} - ${slot.day} at ${slot.time}`);
  });
}

export async function handleRemove(args: string[]): Promise<void> {
  if (args.length < 1) {
    console.error("Usage: octiv remove <index>");
    process.exit(1);
  }

  const index = parseInt(args[0], 10);
  const config = await loadConfig();

  if (isNaN(index) || index < 0 || index >= config.slots.length) {
    console.error(`Invalid index: ${args[0]} (valid: 0-${config.slots.length - 1})`);
    process.exit(1);
  }

  const removed = config.slots[index];
  const updated = removeSlot(config, index);
  await saveConfig(updated);
  console.log(`Removed: ${removed.className} - ${removed.day} at ${removed.time}`);
}

export async function handleNext(): Promise<void> {
  const config = await loadConfig();
  if (config.slots.length === 0) {
    console.log("No slots configured.");
    return;
  }

  const scheduled = getScheduledBookings(config);
  scheduled.sort((a, b) => a.attemptTime.getTime() - b.attemptTime.getTime());

  console.log("Upcoming bookings:");
  console.log();
  for (const s of scheduled) {
    const msUntil = s.attemptTime.getTime() - Date.now();
    const relative = msUntil > 0 ? formatDuration(msUntil) : "PASSED";
    console.log(`  ${s.slot.className} - ${s.slot.day} ${s.slot.time}`);
    console.log(`    Class:   ${s.classDate.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}`);
    console.log(`    Opens:   ${s.openingTime.toLocaleString("fr-FR")}`);
    console.log(`    Attempt: ${s.attemptTime.toLocaleString("fr-FR")} (${relative})`);
    console.log();
  }
}

export async function handleTest(): Promise<void> {
  const config = await loadConfig();
  if (!config.auth.jwt) {
    console.error("Not logged in. Run 'octiv login' first.");
    process.exit(1);
  }

  console.log("Testing API connection...");
  try {
    const userInfo = await getUserInfo(config.auth.jwt);
    console.log(`User: id=${userInfo.userId}, tenant=${userInfo.tenantId}, location=${userInfo.locationId}`);
  } catch (err) {
    console.error(`API test failed (JWT may be expired): ${err}`);
    process.exit(1);
  }

  console.log("\nFetching today's classes...");
  try {
    const today = new Date().toISOString().split("T")[0];
    const classes = await getClassDates(config.auth.jwt, config.auth.tenantId, config.auth.locationId, today);
    if (classes.length === 0) {
      console.log("No classes found for today.");
    } else {
      console.log(`Found ${classes.length} class(es):`);
      for (const c of classes) {
        const time = c.startTime?.slice(0, 5) || "??:??";
        const name = c.name || "?";
        const booked = c.bookings?.length ?? 0;
        const spots = booked >= c.limit ? "FULL" : `${booked}/${c.limit} booked`;
        console.log(`  ${time} - ${name} (${spots})`);
      }
    }
  } catch (err) {
    console.error(`Failed to fetch classes: ${err}`);
  }

  if (config.slots.length > 0) {
    console.log("\nChecking next occurrences for configured slots...");
    const scheduled = getScheduledBookings(config);
    for (const s of scheduled) {
      const dateStr = s.classDate.toISOString().split("T")[0];
      try {
        const classes = await getClassDates(config.auth.jwt, config.auth.tenantId, config.auth.locationId, dateStr);
        const match = findClassByNameAndTime(classes, s.slot.className, s.slot.time);
        if (match) {
          const booked = match.bookings?.length ?? 0;
          console.log(`  ${s.slot.className} ${s.slot.day} ${s.slot.time} → found (id=${match.id}, ${booked}/${match.limit} booked)`);
        } else {
          console.log(`  ${s.slot.className} ${s.slot.day} ${s.slot.time} → not found on ${dateStr}`);
        }
      } catch (err) {
        console.log(`  ${s.slot.className} ${s.slot.day} ${s.slot.time} → error: ${err}`);
      }
    }
  }

  console.log("\nTest complete.");
}

export async function handleRun(): Promise<void> {
  const config = await loadConfig();
  if (!config.auth.jwt) {
    console.error("Not logged in. Run 'octiv' or 'octiv login' first.");
    process.exit(1);
  }
  if (config.slots.length === 0) {
    console.error("No slots configured. Run 'octiv' to set them up.");
    process.exit(1);
  }
  runScheduler(config);
}

// ─── Helpers ───────────────────────────────────────────────────────

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `dans ${days}j ${hours % 24}h ${minutes % 60}m`;
  if (hours > 0) return `dans ${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `dans ${minutes}m ${seconds % 60}s`;
  return `dans ${seconds}s`;
}
