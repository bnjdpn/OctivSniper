#!/usr/bin/env bun
import {
  interactiveMode,
  handleLogin,
  handleAdd,
  handleList,
  handleRemove,
  handleNext,
  handleTest,
  handleRun,
} from "./cli";

const USAGE = `
OctivSniper - Auto-booking for Octiv Fitness

Usage:
  octiv                    Mode interactif (recommande)
  octiv login              Login with email/password
  octiv add <day> <time> <name>  Add a slot to monitor
  octiv list               List configured slots
  octiv remove <index>     Remove a slot by index
  octiv next               Show next scheduled bookings
  octiv test               Test API connection (dry run)
  octiv run                Start the scheduler daemon
`.trim();

const [command, ...args] = process.argv.slice(2);

if (!command) {
  await interactiveMode();
} else {
  switch (command) {
    case "login":
      await handleLogin();
      break;
    case "add":
      await handleAdd(args);
      break;
    case "list":
      await handleList();
      break;
    case "remove":
      await handleRemove(args);
      break;
    case "next":
      await handleNext();
      break;
    case "test":
      await handleTest();
      break;
    case "run":
      await handleRun();
      break;
    default:
      console.log(USAGE);
      break;
  }
}
