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

// Ensure cursor is visible on exit (only if we hid it)
let cursorHidden = false;
const _hideCursorTracked = () => { cursorHidden = true; hideCursor(); };
process.on("exit", () => { if (cursorHidden) showCursor(); });

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

  let cursor = 0;
  const selected = new Set<number>();
  options.forEach((opt, i) => {
    if (opt.selected) selected.add(i);
  });

  const maxVisible = Math.min(options.length, 20);
  let scrollOffset = 0;
  let rendered = false;

  const render = () => {
    if (rendered) moveUp(maxVisible + 1);

    // Keep cursor in view
    if (cursor < scrollOffset) scrollOffset = cursor;
    if (cursor >= scrollOffset + maxVisible)
      scrollOffset = cursor - maxVisible + 1;

    for (let vi = 0; vi < maxVisible; vi++) {
      const i = scrollOffset + vi;
      clearLine();
      if (i < options.length) {
        const isCur = i === cursor;
        const isSel = selected.has(i);
        const prefix = isCur ? cyan("  \u25b8 ") : "    ";
        const check = isSel ? green("\u25cf") : dim("\u25cb");
        const label = isCur ? bold(options[i].label) : options[i].label;
        const hint = options[i].hint ? dim(` ${options[i].hint}`) : "";
        process.stdout.write(`${prefix}${check} ${label}${hint}\n`);
      } else {
        process.stdout.write("\n");
      }
    }

    clearLine();
    const count = selected.size;
    const countStr =
      count > 0 ? green(` ${count} selectionne(s)`) : "";
    const scrollHint =
      options.length > maxVisible
        ? dim("  \u2191\u2193 naviguer  ")
        : dim("  ");
    process.stdout.write(
      `${scrollHint}${dim("\u2191\u2193 naviguer  espace selectionner  a tout  \u21b5 confirmer")}${countStr}\n`
    );
    rendered = true;
  };

  return new Promise((resolve) => {
    const stdin = process.stdin;
    stdin.setRawMode!(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    _hideCursorTracked();

    console.log();
    console.log(bold(`  ${message}`));
    console.log();
    render();

    const onData = (key: string) => {
      if (key === "\x1b[A" || key === "k") {
        cursor = (cursor - 1 + options.length) % options.length;
      } else if (key === "\x1b[B" || key === "j") {
        cursor = (cursor + 1) % options.length;
      } else if (key === " ") {
        if (selected.has(cursor)) selected.delete(cursor);
        else selected.add(cursor);
      } else if (key === "a") {
        if (selected.size === options.length) selected.clear();
        else options.forEach((_, i) => selected.add(i));
      } else if (key === "\r" || key === "\n") {
        stdin.setRawMode!(false);
        stdin.pause();
        stdin.removeListener("data", onData);
        showCursor();
        // Clear the interactive UI: message + blank + maxVisible options + hint = maxVisible + 3
        moveUp(maxVisible + 3);
        eraseBelow();
        // Print summary
        const sel = options.filter((_, i) => selected.has(i));
        if (sel.length > 0) {
          const summary = sel.map((o) => o.label.trim()).join(", ");
          console.log(
            `  ${green("\u2713")} ${bold(`${sel.length} cours selectionne(s)`)}${dim(` — ${summary}`)}`
          );
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

export function spinner(message: string): { stop: (finalMessage?: string) => void } {
  const frames = ["\u280b", "\u2819", "\u2839", "\u2838", "\u283c", "\u2834", "\u2826", "\u2827", "\u2807", "\u280f"];
  let i = 0;
  _hideCursorTracked();
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
