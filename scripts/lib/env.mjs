import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../../..');

export function loadEnv() {
  const envPath = path.join(ROOT, '.env');
  let contents;
  try {
    contents = readFileSync(envPath, 'utf8');
  } catch {
    return;
  }
  for (const line of contents.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

export function requireEnv(key) {
  loadEnv();
  const value = process.env[key];
  if (!value) {
    throw new Error(
      `Missing ${key}. Copy .env.example to .env and set it (see README).`
    );
  }
  return value;
}

// Sets a key in .env, replacing an existing `KEY=` line if present or appending
// a new one otherwise. Used by one-time interactive setup scripts that capture
// a credential (e.g. an OAuth refresh token) so the user doesn't have to hand-copy it.
export function setEnvValue(key, value) {
  const envPath = path.join(ROOT, '.env');
  const lines = existsSync(envPath) ? readFileSync(envPath, 'utf8').split('\n') : [];
  const prefix = `${key}=`;
  const idx = lines.findIndex((line) => line.trim().startsWith(prefix));
  const newLine = `${prefix}${value}`;
  if (idx === -1) {
    if (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
    lines.push(newLine);
  } else {
    lines[idx] = newLine;
  }
  writeFileSync(envPath, `${lines.join('\n').replace(/\n*$/, '')}\n`);
  process.env[key] = value;
}

export const REPO_ROOT = ROOT;
