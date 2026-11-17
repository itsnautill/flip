#!/usr/bin/env node
/* Checks the strings, not the code:
     npm run check:i18n

   1. every key in the Vietnamese table is unique;
   2. a Vietnamese string does not still contain English words (the
      "Switch đến the timer" class of bug);
   3. an English source string does not contain Vietnamese letters;
   4. every user-facing string the UI builds has a Vietnamese entry, or is on
      the short allowlist of things that must stay as they are.

   English is the source language: the UI is written in English and swapped at
   runtime, so a key that is missing here is a label a Vietnamese user would
   see in English. */
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const ui = join(here, "..", "ui");
const problems = [];

/* ------------------------------------------------------------------ 1 + 2 */

const i18n = readFileSync(join(ui, "i18n.js"), "utf8");
const tableStart = i18n.indexOf("var VI = {");
const tableEnd = i18n.indexOf("\n  };", tableStart);
if (tableStart < 0 || tableEnd < 0) {
  problems.push("i18n.js: could not find the VI table");
}
const table = i18n.slice(tableStart, tableEnd);

const keys = [];
const keyPattern = /^\s{4}"((?:[^"\\]|\\.)*)":/gm;
let match;
while ((match = keyPattern.exec(table))) {
  keys.push(match[1].replace(/\\(.)/g, "$1"));
}

const seen = new Set();
const duplicates = new Set();
for (const key of keys) {
  if (seen.has(key)) duplicates.add(key);
  seen.add(key);
}
for (const key of duplicates) problems.push(`duplicate key: "${key}"`);

const entries = [];
const entryPattern = /^\s{4}"((?:[^"\\]|\\.)*)":\s*(?:\r?\n\s*)?"((?:[^"\\]|\\.)*)"/gm;
while ((match = entryPattern.exec(table))) {
  entries.push({ key: match[1], value: match[2] });
}

const ENGLISH_WORDS = [
  "the", "this", "that", "with", "your", "you", "before", "after", "cancel",
  "switch", "click", "please", "save", "delete", "close", "open", "add",
  "and", "from", "when", "while", "error", "failed", "loading", "task",
  "tasks", "timer", "time", "settings", "import", "export", "choose", "pick",
  "today", "tomorrow", "week", "month", "subject", "subjects", "day", "days",
];
const VIETNAMESE = /[àáảãạăằắẳẵặâầấẩẫậđèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵ]/i;

for (const { key, value } of entries) {
  if (!VIETNAMESE.test(value)) continue;
  /* settings.json is a file name, not English prose. */
  const prose = value
    .replace(/[A-Za-z0-9_.-]+\.(?:json|csv|md|exe|xlsx|txt)/gi, " ")
    /* column names a spreadsheet really uses, not prose */
    .replace(/\b(?:Day|Start|End|Subject|Room)\b,?\s*/g, " ");
  const words = prose.toLowerCase().match(/[a-z]{2,}/g) || [];
  const wrong = words.filter((word) => ENGLISH_WORDS.includes(word));
  if (wrong.length) {
    problems.push(
      `mixed language: "${key}" -> "${value}" still contains ${wrong.join(", ")}`
    );
  }
}

/* --------------------------------------------------------------------- 3 */

const ALLOW_TECHNICAL = [
  /^[A-Z]{2,6}$/, // PDF, CSV, AI, API
  /^Mon|Tue|Wed|Thu|Fri|Sat|Sun$/,
  /^Tiếng Việt$/,
];

for (const file of readdirSync(ui).filter((name) => name.endsWith(".js"))) {
  const source = readFileSync(join(ui, file), "utf8");
  const literals = source.match(/"((?:[^"\\]|\\.)*)"/g) || [];
  for (const literal of literals) {
    const text = literal.slice(1, -1);
    if (!VIETNAMESE.test(text)) continue;
    if (file === "i18n.js") continue;
    if (ALLOW_TECHNICAL.some((pattern) => pattern.test(text))) continue;
    problems.push(`${file}: English source contains Vietnamese: "${text}"`);
  }
}

/* --------------------------------------------------------------------- 4 */

/** Strings the UI passes to the helpers that render words. */
function uiStrings(source) {
  const found = new Set();
  const patterns = [
    /Board\.el\(\s*"[^"]*"\s*,\s*"[^"]*"\s*,\s*"((?:[^"\\]|\\.)*)"/g,
    /Board\.toast\(\s*"((?:[^"\\]|\\.)*)"/g,
    /Board\.confirm\(\{[\s\S]*?title:\s*"((?:[^"\\]|\\.)*)"/g,
    /title:\s*"((?:[^"\\]|\\.)*)"/g,
    /saveLabel:\s*"((?:[^"\\]|\\.)*)"/g,
    /confirmLabel:\s*"((?:[^"\\]|\\.)*)"/g,
    /deleteLabel:\s*"((?:[^"\\]|\\.)*)"/g,
    /message:\s*"((?:[^"\\]|\\.)*)"/g,
    /placeholder\s*=\s*"((?:[^"\\]|\\.)*)"/g,
    /placeholder:\s*"((?:[^"\\]|\\.)*)"/g,
    /textContent\s*=\s*"((?:[^"\\]|\\.)*)"/g,
    /setAttribute\(\s*"aria-label"\s*,\s*"((?:[^"\\]|\\.)*)"/g,
    /aria-label="([^"]*)"/g,
  ];
  for (const pattern of patterns) {
    let hit;
    while ((hit = pattern.exec(source))) found.add(hit[1]);
  }
  return found;
}

/** Strings that are markup, identifiers, or already translated elsewhere. */
const ALLOW_UNTRANSLATED = [
  /^$/,
  /^[\s\d.:;,\-–—·%()/+*#]*$/,
  /^(?:https?:|#|\.|\/)/,
  /^[a-z][a-z0-9-]*$/, // data-days, aria-labels used as selectors
  /^[A-Za-z]+(\.[A-Za-z]+)+$/, // file names
  /^(?:Board|Flip|Tauri|Rust|Discord|OpenAI|Excel|Google|Downloads|FlipData|API|AI|JSON|CSV|PDF)$/,
  /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)$/,
  /^Tiếng Việt$/,
  /^Show$|^Hide$/, // translated, listed here for the short labels
  /^Math$|^B12 · Ms Lane$/,
  /* Prefixes the UI joins to a value; the finished sentence has its own rule
     in i18n.js, so the prefix alone is never rendered. */
  /^(?:Moved to|Scheduled for|Add a task on|Edit |Add a subject to|Days:|Rows:|Subjects:)$/,
  /^(?:Focus session started|Focus session saved) ·$/,
];

const englishKeys = new Set(keys);
const allowedRules = [/^\d/, /^(.+)…$/];

const sources = [
  ...readdirSync(ui)
    .filter((name) => name.endsWith(".js") && name !== "i18n.js")
    .map((name) => ({ name, text: readFileSync(join(ui, name), "utf8") })),
  { name: "index.html", text: readFileSync(join(ui, "index.html"), "utf8") },
];

for (const { name, text } of sources) {
  for (const raw of uiStrings(text)) {
    const untrimmed = raw.replace(/\\(.)/g, "$1");
    const value = untrimmed.trim();
    if (!value) continue;
    if (englishKeys.has(value)) continue;
    /* A trailing space means the UI joins a value onto this prefix. */
    if (/\s$/.test(untrimmed)) continue;
    if (ALLOW_TECHNICAL.some((pattern) => pattern.test(value))) continue;
    if (ALLOW_UNTRANSLATED.some((pattern) => pattern.test(value))) continue;
    if (allowedRules.some((pattern) => pattern.test(value))) continue;
    // Strings assembled around a variable are translated by the rules above.
    if (/[{}]|\+\s*[a-zA-Z_(]/.test(value)) continue;
    problems.push(`${name}: no Vietnamese entry for "${value}"`);
  }
}

/* ------------------------------------------------- 5. plain English leftovers */

/** Words that must never be glued onto a value by hand. "0 session" + "s" is
    how English leaked into the Vietnamese UI. Only literals the code joins or
    assigns as text are checked, so class names and key names stay legal. */
const PLAIN_ENGLISH = new Set([
  "session", "sessions", "cancel", "save", "delete", "loading", "minute",
  "minutes", "today", "tomorrow", "settings", "clear", "undo", "redo",
]);

for (const { name, text } of sources) {
  if (name === "i18n.js") continue;
  const joined = [
    ...text.matchAll(/\+\s*"([A-Za-z ]{3,12})"/g),
    ...text.matchAll(/textContent\s*=\s*"([A-Za-z ]{3,12})"/g),
  ];
  for (const hit of joined) {
    const value = hit[1].trim();
    if (!PLAIN_ENGLISH.has(value.toLowerCase())) continue;
    if (englishKeys.has(value)) continue;
    problems.push(name + ': hardcoded English "' + value + '" - put it in i18n.js');
  }
}

/* ------------------------------------------------------------------ report */

if (problems.length) {
  console.error(`i18n check failed (${problems.length}):`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log(`i18n check passed: ${keys.length} keys, ${sources.length} files.`);
