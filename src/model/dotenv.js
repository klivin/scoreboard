import fs from 'fs';
import path from 'path';

/**
 * Tiny .env parser. Zero dependencies.
 * Existing process.env values win unless override is true.
 * Never logs values.
 */
export function parseDotenv(text) {
  const out = {};
  if (typeof text !== 'string' || !text) return out;
  for (const rawLine of text.split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('export ')) line = line.slice(7).trim();
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2)
      || (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    } else {
      const hash = value.indexOf(' #');
      if (hash !== -1) value = value.slice(0, hash).trim();
    }
    out[key] = value;
  }
  return out;
}

export function loadDotenv({
  env = process.env,
  cwd = process.cwd(),
  filename = '.env',
  override = false,
  readFile = fs.readFileSync,
  exists = fs.existsSync
} = {}) {
  const filePath = path.resolve(cwd, filename);
  if (!exists(filePath)) {
    return { loaded: false, path: filePath, applied: [] };
  }
  const parsed = parseDotenv(String(readFile(filePath, 'utf8')));
  const applied = [];
  for (const [key, value] of Object.entries(parsed)) {
    const current = env[key];
    if (!override && current != null && current !== '') continue;
    env[key] = value;
    applied.push(key);
  }
  return { loaded: true, path: filePath, applied };
}
