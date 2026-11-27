import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { ruleApplies } from '../engines/review.ts';
import type { AssistantTask, Directory, Target } from '../types.ts';
import { assistantChecks } from './checks.ts';

const SKIP = new Set(['node_modules', 'vendor', 'bower_components']);
const MAX_FILE = 2 * 1024 * 1024;
const MAX_FILES = 20;

/** POSIX paths relative to the folder, sorted. Dot folders and vendor folders are left out. */
export function listFiles(root: string): string[] {
  const out: string[] = [];
  const visit = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP.has(e.name)) visit(full);
      } else if (e.isFile()) out.push(path.relative(root, full).split(path.sep).join('/'));
    }
  };
  visit(root);
  return out.sort();
}

/** The checks a run leaves to an AI assistant, in the order of assistantChecks. */
export function assistantTasks(target: Target, settings: { level: number; directory?: Directory }): AssistantTask[] {
  const chosen = assistantChecks.filter((c) => ruleApplies(c, { target, level: settings.level, ...(settings.directory ? { directory: settings.directory } : {}) }));
  if (chosen.length === 0) return [];
  let files: string[] | undefined;
  const cache = new Map<string, string>();
  // An unreadable, oversized or binary file reads as empty text and matches nothing.
  const read = (file: string): string => {
    let text = cache.get(file);
    if (text === undefined) {
      try {
        const full = path.join(target.path, file);
        text = statSync(full).size > MAX_FILE ? '' : readFileSync(full, 'utf8');
        if (text.includes('\0')) text = '';
      } catch {
        text = '';
      }
      cache.set(file, text);
    }
    return text;
  };
  const tasks: AssistantTask[] = [];
  for (const c of chosen) {
    let matched: string[] = [];
    if (c.look) {
      const { ext, match } = c.look;
      files ??= listFiles(target.path);
      // A g or y flag would make test() keep its place between files.
      const re = new RegExp(match.source, match.flags.replace(/[gy]/g, ''));
      matched = files.filter((f) => ext.includes(path.extname(f).slice(1).toLowerCase()) && re.test(read(f))).slice(0, MAX_FILES);
      if (matched.length === 0) continue;
    }
    tasks.push({ id: c.id, title: c.title, prompt: c.prompt, files: matched, ...(c.docs ? { docs: c.docs } : {}) });
  }
  return tasks;
}
