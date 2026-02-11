# CLAUDE.md

## Project overview

OctivSniper auto-books CrossFit classes on Octiv Fitness (CrossFit Myrmica) the instant the booking window opens. Classes open 4 days before at the class end time. The app pre-fetches class IDs, starts attempts 30s early, and retries aggressively.

## Stack

- **Runtime:** Bun (TypeScript, no transpile step)
- **Dependencies:** None at runtime. `bun-types` dev only.
- **No framework** - pure CLI with `process.argv` routing

## Commands

```
bun run src/index.ts <command>
```

| Command | Description |
|---------|-------------|
| `login` | Interactive email/password prompt, stores JWT in config.json |
| `add <day> <time> <name>` | Add a slot (e.g. `add monday 07:00 WOD`) |
| `list` | Show configured slots |
| `remove <index>` | Remove a slot by index |
| `next` | Display upcoming booking attempts with timing |
| `test` | Dry-run: validate JWT, fetch today's classes, check slot matching |
| `run` | Start the scheduler daemon (long-running) |

## Architecture

```
src/
  index.ts       # Entry point, arg routing
  cli.ts         # Command handlers (login, add, list, remove, next, test, run)
  api.ts         # Octiv REST client (login, getUserInfo, getClassDates, bookClass, cancelBooking)
  scheduler.ts   # Opening time calculation, pre-fetch, retry loop, weekly reschedule
  config.ts      # config.json read/write, validation helpers
  types.ts       # Shared TypeScript interfaces
```

## Key files

- `config.json` — **gitignored**, contains JWT + user credentials + slot list
- `src/api.ts` — all Octiv API calls, base URL: `https://app.octivfitness.com`
- `src/scheduler.ts` — core booking logic: 30s anticipation, 2min pre-fetch, retry with configurable interval

## API details

Base: `https://app.octivfitness.com`

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/login` | POST | Auth (email + password -> JWT) |
| `/api/users/me` | GET | User info (userId, tenantId, locationId) |
| `/api/class-dates` | GET | List classes for a date range |
| `/api/class-bookings` | POST | Book a class (classDateId + userId) |
| `/api/class-bookings/{id}/cancel` | PUT | Cancel a booking |

Required headers: `Authorization: Bearer <JWT>`, `X-CamelCase: true`, `Accept: application/json`

## Conventions

- No external dependencies — use Bun built-ins (`Bun.file`, `Bun.write`, `Bun.sleep`, `fetch`)
- Config defaults in `src/config.ts` (`DEFAULT_CONFIG`)
- Days are lowercase English strings (`monday`..`sunday`)
- Times are `HH:MM` 24h format
- French locale for date display in CLI output
- Logging format: `[ISO timestamp] message`

## Config structure

```json
{
  "auth": { "email", "jwt", "userId", "tenantId", "locationId" },
  "advanceBookingDays": 4,
  "slots": [{ "day": "monday", "time": "07:00", "className": "WOD" }],
  "retryIntervalMs": 500,
  "maxRetries": 20
}
```

## Booking logic

1. For each slot, calculate next class date occurrence
2. Opening = classDate - advanceBookingDays + classDuration (default 60min)
3. Pre-fetch classDateId 2 minutes before
4. Start attempts 30 seconds before opening
5. Retry every 500ms up to 20 times
6. On completion (success or fail), schedule next week automatically
