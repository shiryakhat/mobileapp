import fs from 'node:fs';
import path from 'node:path';

export function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
}

export function readJsonIfExists<T>(file: string): T | undefined {
  return fs.existsSync(file) ? readJson<T>(file) : undefined;
}

/** Atomic write so an interrupted run never leaves a half-written file. */
export function writeJson(file: string, data: unknown, pretty = true): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, (pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data)) + '\n');
  fs.renameSync(tmp, file);
}

export function writeText(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}
