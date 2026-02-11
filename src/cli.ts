import { loadConfig, saveConfig, addSlot, removeSlot, isValidDay, isValidTime } from "./config";
import { login, getUserInfo, getClassDates, findClassByNameAndTime } from "./api";
import { getScheduledBookings, runScheduler } from "./scheduler";
import type { DayOfWeek } from "./types";

export async function handleLogin(): Promise<void> {
  const config = await loadConfig();

  process.stdout.write("Email: ");
  const email = (await readLine()).trim();
  const password = await readPassword("Password: ");

  console.log("Logging in...");
  try {
    const { jwt } = await login(email, password);
    console.log("Login successful! Fetching user info...");

    const userInfo = await getUserInfo(jwt);
    config.auth = {
      email,
      jwt,
      userId: userInfo.userId,
      tenantId: userInfo.tenantId || config.auth.tenantId,
      locationId: userInfo.locationId || config.auth.locationId,
    };

    await saveConfig(config);
    console.log(`Saved! userId=${config.auth.userId}, tenantId=${config.auth.tenantId}, locationId=${config.auth.locationId}`);
  } catch (err) {
    console.error(`Login failed: ${err}`);
    process.exit(1);
  }
}

export async function handleAdd(args: string[]): Promise<void> {
  if (args.length < 3) {
    console.error("Usage: octiv add <day> <time> <className>");
    console.error("Example: octiv add monday 07:00 WOD");
    process.exit(1);
  }

  const [day, time, ...rest] = args;
  const className = rest.join(" ");

  if (!isValidDay(day)) {
    console.error(`Invalid day: ${day}`);
    console.error("Valid days: monday, tuesday, wednesday, thursday, friday, saturday, sunday");
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
  console.log(`Total slots: ${updated.slots.length}`);
}

export async function handleList(): Promise<void> {
  const config = await loadConfig();

  if (config.slots.length === 0) {
    console.log("No slots configured.");
    console.log("Use 'octiv add <day> <time> <className>' to add one.");
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

  console.log("Upcoming bookings:");
  console.log();

  // Sort by attempt time
  scheduled.sort((a, b) => a.attemptTime.getTime() - b.attemptTime.getTime());

  for (const s of scheduled) {
    const now = new Date();
    const msUntil = s.attemptTime.getTime() - now.getTime();
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

  console.log();
  console.log("Fetching today's classes...");

  try {
    const today = new Date().toISOString().split("T")[0];
    const classes = await getClassDates(
      config.auth.jwt,
      config.auth.tenantId,
      config.auth.locationId,
      today
    );

    if (classes.length === 0) {
      console.log("No classes found for today.");
    } else {
      console.log(`Found ${classes.length} class(es):`);
      for (const c of classes) {
        const start = new Date(c.startAt);
        const time = `${start.getHours().toString().padStart(2, "0")}:${start.getMinutes().toString().padStart(2, "0")}`;
        const spots = c.isFull ? "FULL" : `${c.availableSpots}/${c.totalSpots} spots`;
        console.log(`  ${time} - ${c.className} (${spots})`);
      }
    }
  } catch (err) {
    console.error(`Failed to fetch classes: ${err}`);
  }

  // Test matching configured slots
  if (config.slots.length > 0) {
    console.log();
    console.log("Checking next occurrences for configured slots...");
    const scheduled = getScheduledBookings(config);
    for (const s of scheduled) {
      const dateStr = s.classDate.toISOString().split("T")[0];
      try {
        const classes = await getClassDates(
          config.auth.jwt,
          config.auth.tenantId,
          config.auth.locationId,
          dateStr
        );
        const match = findClassByNameAndTime(classes, s.slot.className, s.slot.time);
        if (match) {
          console.log(`  ${s.slot.className} ${s.slot.day} ${s.slot.time} → found (id=${match.id}, ${match.availableSpots}/${match.totalSpots} spots)`);
        } else {
          console.log(`  ${s.slot.className} ${s.slot.day} ${s.slot.time} → not found on ${dateStr}`);
        }
      } catch (err) {
        console.log(`  ${s.slot.className} ${s.slot.day} ${s.slot.time} → error: ${err}`);
      }
    }
  }

  console.log();
  console.log("Test complete.");
}

export async function handleRun(): Promise<void> {
  const config = await loadConfig();

  if (!config.auth.jwt) {
    console.error("Not logged in. Run 'octiv login' first.");
    process.exit(1);
  }

  if (config.slots.length === 0) {
    console.error("No slots configured. Run 'octiv add <day> <time> <className>' first.");
    process.exit(1);
  }

  runScheduler(config);
}

function readLine(): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    const onData = (chunk: Buffer) => {
      chunks.push(chunk);
      const str = Buffer.concat(chunks).toString();
      if (str.includes("\n")) {
        process.stdin.removeListener("data", onData);
        process.stdin.pause();
        resolve(str.split("\n")[0]);
      }
    };
    process.stdin.resume();
    process.stdin.on("data", onData);
  });
}

function readPassword(prompt: string): Promise<string> {
  process.stdout.write(prompt);

  // If not a TTY (piped input), fall back to normal readLine
  if (!process.stdin.isTTY) {
    return readLine();
  }

  return new Promise((resolve) => {
    const stdin = process.stdin;
    stdin.setRawMode!(true);
    stdin.resume();
    stdin.setEncoding("utf8");

    let password = "";
    const onData = (ch: string) => {
      const c = ch.toString();
      if (c === "\n" || c === "\r" || c === "\u0004") {
        stdin.setRawMode!(false);
        stdin.pause();
        stdin.removeListener("data", onData);
        process.stdout.write("\n");
        resolve(password);
      } else if (c === "\u0003") {
        stdin.setRawMode!(false);
        process.stdout.write("\n");
        process.exit(0);
      } else if (c === "\u007f" || c === "\b") {
        if (password.length > 0) {
          password = password.slice(0, -1);
          process.stdout.write("\b \b");
        }
      } else {
        password += c;
        process.stdout.write("*");
      }
    };
    stdin.on("data", onData);
  });
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `in ${days}d ${hours % 24}h ${minutes % 60}m`;
  if (hours > 0) return `in ${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `in ${minutes}m ${seconds % 60}s`;
  return `in ${seconds}s`;
}
