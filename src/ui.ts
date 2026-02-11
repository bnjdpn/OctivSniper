const CSI = "\x1b[";

// Colors
export const bold = (s: string) => `${CSI}1m${s}${CSI}0m`;
export const dim = (s: string) => `${CSI}2m${s}${CSI}0m`;
export const green = (s: string) => `${CSI}32m${s}${CSI}0m`;
export const cyan = (s: string) => `${CSI}36m${s}${CSI}0m`;
export const yellow = (s: string) => `${CSI}33m${s}${CSI}0m`;
export const red = (s: string) => `${CSI}31m${s}${CSI}0m`;

const hideCursor = () => process.stdout.write(`${CSI}?25l`);
const showCursor = () => process.stdout.write(`${CSI}?25h`);
const clearLine = () => process.stdout.write(`${CSI}2K\r`);
const moveUp = (n: number) => {
  if (n > 0) process.stdout.write(`${CSI}${n}A`);
};
const eraseBelow = () => process.stdout.write(`${CSI}J`);

let cursorHidden = false;
const trackHideCursor = () => {
  cursorHidden = true;
  hideCursor();
};
process.on("exit", () => {
  if (cursorHidden) showCursor();
});

export function input(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(prompt);
    const chunks: Buffer[] = [];
    const onData = (chunk: Buffer) => {
      chunks.push(chunk);
      const str = Buffer.concat(chunks).toString();
      if (str.includes("\n")) {
        process.stdin.removeListener("data", onData);
        process.stdin.pause();
        resolve(str.split("\n")[0].trim());
      }
    };
    process.stdin.resume();
    process.stdin.on("data", onData);
  });
}

export function password(prompt: string): Promise<string> {
  process.stdout.write(prompt);
  if (!process.stdin.isTTY) return input("");

  return new Promise((resolve) => {
    const stdin = process.stdin;
    stdin.setRawMode!(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let pw = "";
    const onData = (ch: string) => {
      if (ch === "\r" || ch === "\n" || ch === "\u0004") {
        stdin.setRawMode!(false);
        stdin.pause();
        stdin.removeListener("data", onData);
        process.stdout.write("\n");
        resolve(pw);
      } else if (ch === "\u0003") {
        stdin.setRawMode!(false);
        showCursor();
        process.stdout.write("\n");
        process.exit(0);
      } else if (ch === "\u007f" || ch === "\b") {
        if (pw.length > 0) {
          pw = pw.slice(0, -1);
          process.stdout.write("\b \b");
        }
      } else {
        pw += ch;
        process.stdout.write("*");
      }
    };
    stdin.on("data", onData);
  });
}

export interface MultiSelectOption<T> {
  label: string;
  value: T;
  hint?: string;
  selected?: boolean;
  group?: string;
  groupLabel?: string;
}

export function multiSelect<T>(opts: {
  message: string;
  options: MultiSelectOption<T>[];
}): Promise<T[]> {
  const { message, options } = opts;

  if (options.length === 0) {
    console.log(yellow("  Aucun cours disponible."));
    return Promise.resolve([]);
  }

  // Build groups
  const groups: { key: string; label: string; indices: number[] }[] = [];
  let prevKey = "";
  for (let i = 0; i < options.length; i++) {
    const g = options[i].group ?? "";
    if (g !== prevKey) {
      groups.push({ key: g, label: options[i].groupLabel ?? g, indices: [] });
      prevKey = g;
    }
    groups[groups.length - 1].indices.push(i);
  }
  const hasGroups = groups.length > 1;

  let groupIdx = 0;
  let cursor = 0; // index within current group
  let scrollOffset = 0;
  const selected = new Set<number>(); // global indices
  options.forEach((opt, i) => {
    if (opt.selected) selected.add(i);
  });

  // Fixed render height so switching days doesn't shift the terminal
  const termRows = process.stdout.rows || 24;
  const maxGroupSize = Math.max(...groups.map((g) => g.indices.length));
  const maxVisible = Math.min(maxGroupSize, hasGroups ? termRows - 7 : termRows - 5);

  // Render area lines: header(2 if grouped) + options(maxVisible) + hint(1)
  const headerLines = hasGroups ? 2 : 0; // header + blank
  const renderLines = headerLines + maxVisible + 1; // + hint

  let rendered = false;

  const render = () => {
    if (rendered) moveUp(renderLines);

    const group = groups[groupIdx];
    const groupLen = group.indices.length;

    // Keep cursor in view
    if (cursor < scrollOffset) scrollOffset = cursor;
    if (cursor >= scrollOffset + maxVisible)
      scrollOffset = cursor - maxVisible + 1;

    // Header
    if (hasGroups) {
      clearLine();
      const left = groupIdx > 0 ? dim("\u25c0 ") : "  ";
      const right = groupIdx < groups.length - 1 ? dim(" \u25b6") : "  ";
      const pos = dim(` (${groupIdx + 1}/${groups.length})`);
      process.stdout.write(`  ${left}${bold(group.label)}${right}${pos}\n`);
      clearLine();
      process.stdout.write("\n");
    }

    // Options
    for (let vi = 0; vi < maxVisible; vi++) {
      const localIdx = scrollOffset + vi;
      clearLine();
      if (localIdx < groupLen) {
        const globalIdx = group.indices[localIdx];
        const isCur = localIdx === cursor;
        const isSel = selected.has(globalIdx);
        const prefix = isCur ? cyan("  \u25b8 ") : "    ";
        const check = isSel ? green("\u25cf") : dim("\u25cb");
        const label = isCur ? bold(options[globalIdx].label) : options[globalIdx].label;
        const hint = options[globalIdx].hint ? dim(` ${options[globalIdx].hint}`) : "";
        process.stdout.write(`${prefix}${check} ${label}${hint}\n`);
      } else {
        process.stdout.write("\n");
      }
    }

    // Hint
    clearLine();
    const count = selected.size;
    const countStr = count > 0 ? green(`  ${count} sel.`) : "";
    const nav = hasGroups
      ? dim("  \u2190\u2192 jour  \u2191\u2193 cours  espace sel.  a jour  \u21b5 ok")
      : dim("  \u2191\u2193 naviguer  espace selectionner  a tout  \u21b5 confirmer");
    process.stdout.write(`${nav}${countStr}\n`);
    rendered = true;
  };

  // Message (printed once, above render area)
  const messageLines = 2; // blank + message
  console.log();
  console.log(bold(`  ${message}`));

  return new Promise((resolve) => {
    const stdin = process.stdin;
    stdin.setRawMode!(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    trackHideCursor();

    render();

    const onData = (key: string) => {
      const group = groups[groupIdx];
      const groupLen = group.indices.length;

      if (key === "\x1b[A" || key === "k") {
        cursor = (cursor - 1 + groupLen) % groupLen;
      } else if (key === "\x1b[B" || key === "j") {
        cursor = (cursor + 1) % groupLen;
      } else if (key === "\x1b[C" && hasGroups) {
        if (groupIdx < groups.length - 1) {
          groupIdx++;
          cursor = 0;
          scrollOffset = 0;
        }
      } else if (key === "\x1b[D" && hasGroups) {
        if (groupIdx > 0) {
          groupIdx--;
          cursor = 0;
          scrollOffset = 0;
        }
      } else if (key === " ") {
        const globalIdx = group.indices[cursor];
        if (selected.has(globalIdx)) selected.delete(globalIdx);
        else selected.add(globalIdx);
      } else if (key === "a") {
        // Toggle all in current day
        const indices = hasGroups ? group.indices : options.map((_, i) => i);
        const allSel = indices.every((i) => selected.has(i));
        if (allSel) indices.forEach((i) => selected.delete(i));
        else indices.forEach((i) => selected.add(i));
      } else if (key === "\r" || key === "\n") {
        stdin.setRawMode!(false);
        stdin.pause();
        stdin.removeListener("data", onData);
        showCursor();
        // Clear entire UI
        moveUp(renderLines + messageLines);
        eraseBelow();
        // Summary
        const sel = options.filter((_, i) => selected.has(i));
        if (sel.length > 0) {
          console.log(`  ${green("\u2713")} ${bold(`${sel.length} cours selectionne(s)`)}`);
        } else {
          console.log(`  ${yellow("\u2013")} Aucun cours selectionne`);
        }
        resolve(sel.map((o) => o.value));
        return;
      } else if (key === "\x03") {
        stdin.setRawMode!(false);
        showCursor();
        process.stdout.write("\n");
        process.exit(0);
      }
      render();
    };
    stdin.on("data", onData);
  });
}

export function spinner(
  message: string
): { stop: (finalMessage?: string) => void } {
  const frames = [
    "\u280b", "\u2819", "\u2839", "\u2838", "\u283c",
    "\u2834", "\u2826", "\u2827", "\u2807", "\u280f",
  ];
  let i = 0;
  trackHideCursor();
  const interval = setInterval(() => {
    clearLine();
    process.stdout.write(`  ${cyan(frames[i % frames.length])} ${message}`);
    i++;
  }, 80);

  return {
    stop(finalMessage?: string) {
      clearInterval(interval);
      clearLine();
      if (finalMessage) {
        process.stdout.write(`  ${green("\u2713")} ${finalMessage}\n`);
      }
      showCursor();
    },
  };
}
