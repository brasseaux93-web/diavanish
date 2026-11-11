/*
 * Interface copy: every key the screens ask for must exist in English, and
 * every English key must exist in Arabic, Spanish and French, so no screen
 * ever shows a raw key name or silently falls back to another language.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { dicts } from "../client/src/lib/i18n";
import { CONTACT_EMAIL } from "../shared/contact";

const SRC = path.join(import.meta.dirname, "..", "client", "src");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) return sourceFiles(p);
    return /\.tsx?$/.test(name) ? [p] : [];
  });
}

test("every language has every English key", () => {
  const keys = Object.keys(dicts.en);
  for (const lang of ["ar", "es", "fr"] as const) {
    const missing = keys.filter((k) => !(k in dicts[lang]));
    assert.deepEqual(missing, [], `${lang} is missing ${missing.length} key(s)`);
  }
});

test("no language has an empty string", () => {
  for (const [lang, dict] of Object.entries(dicts)) {
    const empty = Object.entries(dict).filter(([, v]) => v.trim() === "").map(([k]) => k);
    assert.deepEqual(empty, [], `${lang} has empty strings`);
  }
});

test("placeholders match the English string in every language", () => {
  const slots = (s: string) => (s.match(/\{[a-zA-Z0-9_]+\}/g) ?? []).sort().join(",");
  const bad: string[] = [];
  for (const lang of ["ar", "es", "fr"] as const) {
    for (const [k, v] of Object.entries(dicts.en)) {
      const other = dicts[lang][k];
      if (other !== undefined && slots(other) !== slots(v)) bad.push(`${lang}.${k}`);
    }
  }
  assert.deepEqual(bad, []);
});

test("every literal t(\"key\") used by a screen exists in English", () => {
  const missing = new Set<string>();
  for (const file of sourceFiles(SRC)) {
    const text = readFileSync(file, "utf8");
    for (const m of Array.from(text.matchAll(/(?<![A-Za-z0-9_.])t\(\s*"([a-zA-Z0-9_]+)"\s*[,)]/g))) {
      if (!(m[1] in dicts.en)) missing.add(`${m[1]} (${path.relative(SRC, file)})`);
    }
  }
  assert.deepEqual(Array.from(missing).sort(), []);
});

test("the contact address is the project mailbox and no screen hard-codes another", () => {
  assert.equal(CONTACT_EMAIL, "admin@diavanish.org");
  const stray: string[] = [];
  for (const file of sourceFiles(SRC)) {
    const text = readFileSync(file, "utf8");
    for (const m of Array.from(text.matchAll(/[a-z0-9._-]+@diavanish\.org/gi))) {
      if (m[0] !== CONTACT_EMAIL) stray.push(`${m[0]} (${path.relative(SRC, file)})`);
    }
  }
  assert.deepEqual(stray, []);
});
