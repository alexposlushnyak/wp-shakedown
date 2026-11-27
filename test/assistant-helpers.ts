import { chmodSync } from 'node:fs';
import path from 'node:path';
import { saveRun } from '../src/history.ts';
import { savePreset } from '../src/presets.ts';
import { toJson } from '../src/report/json.ts';
import { defaultReportDir } from '../src/report/write.ts';
import { detectTarget } from '../src/target.ts';
import type { AssistantProvider, AssistantTask } from '../src/types.ts';
import { result, write } from './helpers.ts';

export const FAIL_ANSWER = '{"verdict":"fail","findings":[{"file":"a.php","line":3,"severity":"critical","message":"m"}]}';

export const tasks: AssistantTask[] = [
  { id: 'one', title: 'First check', prompt: 'Look.', files: ['a.php'] },
  { id: 'two', title: 'Second check', prompt: 'Look again.', files: [] },
];

/** A Node script named `name` in `dir`, which the test puts first on PATH. */
export function fakeBin(dir: string, name: string, body: string): void {
  const file = path.join(dir, name);
  write(file, `#!/usr/bin/env node\n${body}\n`);
  chmodSync(file, 0o755);
}

/** Saves a preset with an assistant (or none), writes a run that uses it into the report folder of `theme` and returns that folder. WP_SHAKEDOWN_HOME must be set. */
export function setupRun(theme: string, provider: AssistantProvider | undefined): string {
  savePreset({ id: 'ai', title: 'AI', summary: 'Test', kinds: ['theme'], engines: ['fake'], ...(provider ? { assistant: provider } : {}) });
  const target = detectTarget(theme);
  const dir = defaultReportDir(target);
  const r = result([], { target, preset: 'ai', assistant: tasks });
  write(path.join(dir, 'report.json'), toJson(r));
  saveRun(dir, r);
  return dir;
}
