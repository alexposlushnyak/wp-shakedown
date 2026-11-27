import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { home } from '../home.ts';

// shortcut: a file readable only by the user, not the system keychain. Move to the keychain when someone asks.
const dir = (): string => path.join(home(), 'keys');
const fileOf = (): string => path.join(dir(), 'anthropic');

/** ANTHROPIC_API_KEY first, then the key file. Throws when other users can read the file. */
export function anthropicKey(): string | undefined {
  const env = process.env.ANTHROPIC_API_KEY?.trim();
  if (env) return env;
  const file = fileOf();
  if (!existsSync(file)) return undefined;
  if (process.platform !== 'win32' && (statSync(file).mode & 0o077) !== 0) {
    throw new Error(`The key file ${file} can be read by other users. Run chmod 600 ${file}.`);
  }
  return readFileSync(file, 'utf8').trim() || undefined;
}

/** Writes the key with mode 0600 into a folder with mode 0700 and returns the path. */
export function saveAnthropicKey(key: string): string {
  mkdirSync(dir(), { recursive: true, mode: 0o700 });
  // mkdirSync leaves the mode of a folder that exists already.
  chmodSync(dir(), 0o700);
  const file = fileOf();
  writeFileSync(file, `${key.trim()}\n`, { mode: 0o600 });
  // The mode of writeFileSync does not apply to a file that exists already.
  chmodSync(file, 0o600);
  return file;
}

/** Returns false when there was no key file. */
export function removeAnthropicKey(): boolean {
  if (!existsSync(fileOf())) return false;
  rmSync(fileOf());
  return true;
}
