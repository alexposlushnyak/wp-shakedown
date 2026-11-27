import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import type Anthropic from '@anthropic-ai/sdk';
import { npmTools } from '../npm-tools.ts';
import type { AssistantAnswer, AssistantProvider, AssistantTask, Target } from '../types.ts';
import { anthropicKey } from './keys.ts';
import { ANSWER_SCHEMA, assistantPrompt, parseAnswer } from './prompt.ts';
import { listFiles } from './select.ts';

const TIMEOUT_MS = 10 * 60 * 1000;
const MAX_CHARS = 400_000;
const TEXT_EXT = new Set(['php', 'js', 'jsx', 'ts', 'tsx', 'css', 'scss', 'json', 'html', 'txt', 'md', 'svg', 'xml']);

const NOT_INSTALLED = {
  claude: 'Claude Code is not installed. Install it, or set another assistant in the preset.',
  codex: 'Codex is not installed. Install it, or set another assistant in the preset.',
};

interface Ran {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** Runs a command without a shell, writes `input` to its stdin and stops it after the timeout or on the signal. */
function run(cmd: string, args: string[], cwd: string, input: string, signal?: AbortSignal): Promise<Ran> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'], signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]) : AbortSignal.timeout(TIMEOUT_MS) });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c: Buffer) => (stdout += c));
    child.stderr.on('data', (c: Buffer) => (stderr += c));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    // A child that exits early closes the pipe. The exit code tells the story.
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

async function viaClaude(task: AssistantTask, target: Target, signal?: AbortSignal): Promise<AssistantAnswer> {
  // Only the user's own settings: a .claude folder inside the theme could otherwise add hooks that run commands.
  const args = ['-p', '--output-format', 'json', '--json-schema', JSON.stringify(ANSWER_SCHEMA), '--tools', 'Read,Grep,Glob', '--permission-mode', 'dontAsk', '--setting-sources', 'user', '--strict-mcp-config', '--no-session-persistence'];
  const r = await run('claude', args, target.path, assistantPrompt(task, target, 'here'), signal);
  let out: { structured_output?: unknown; result?: unknown; is_error?: boolean } | undefined;
  try {
    out = JSON.parse(r.stdout) as typeof out;
  } catch {
    // The error text below covers it.
  }
  if (r.code !== 0 || !out || out.is_error) {
    throw new Error((r.stderr.trim() || (typeof out?.result === 'string' ? out.result : '') || r.stdout.trim() || `Claude Code exited with code ${r.code}.`).slice(0, 300));
  }
  const raw = out.structured_output !== null && typeof out.structured_output === 'object' ? JSON.stringify(out.structured_output) : String(out.result ?? '');
  return parseAnswer(task.id, raw);
}

async function viaCodex(task: AssistantTask, target: Target, signal?: AbortSignal): Promise<AssistantAnswer> {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'wps-codex-'));
  try {
    const file = path.join(tmp, 'answer.txt');
    const r = await run('codex', ['exec', '--sandbox', 'read-only', '--skip-git-repo-check', '--cd', target.path, '--output-last-message', file, '-'], target.path, assistantPrompt(task, target, 'here'), signal);
    if (r.code !== 0) throw new Error((r.stderr.trim() || `Codex exited with code ${r.code}.`).slice(0, 300));
    return parseAnswer(task.id, readFileSync(file, 'utf8'));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** The text files of the target, found the same way the checks find theirs. */
const textFiles = (root: string): string[] => listFiles(root).filter((f) => TEXT_EXT.has(path.extname(f).slice(1).toLowerCase()));

/** The prompt followed by the files, up to MAX_CHARS. Files that do not fit are named. */
function withFiles(task: AssistantTask, target: Target): string {
  let text = assistantPrompt(task, target, 'here');
  let used = text.length;
  const left: string[] = [];
  for (const file of task.files.length > 0 ? task.files : textFiles(target.path)) {
    const full = path.join(target.path, file);
    let body: string;
    try {
      body = statSync(full).size > MAX_CHARS ? '' : readFileSync(full, 'utf8');
    } catch {
      continue;
    }
    const block = `\n--- ${file} ---\n${body}\n`;
    if (body === '' || used + block.length > MAX_CHARS) left.push(file);
    else {
      text += block;
      used += block.length;
    }
  }
  return left.length > 0 ? `${text}\nThese files did not fit and were left out: ${left.join(', ')}.\n` : text;
}

// Most people answer the checks through Claude Code or Codex, so the SDK is fetched only when the api provider first runs.
const sdkTools = npmTools({
  folder: 'ai-tools',
  files: ['package.json', 'package-lock.json'],
  hashed: ['package-lock.json'],
  prefix: 'ai',
  ready: 'node_modules/@anthropic-ai/sdk/package.json',
  what: 'the Anthropic SDK',
  installing: 'Installing the Anthropic SDK. This happens once.',
});

async function loadSdk(): Promise<typeof Anthropic> {
  const dir = await sdkTools.get((m) => process.stderr.write(`${m}\n`));
  const mod = createRequire(path.join(dir, 'package.json'))('@anthropic-ai/sdk') as { default?: typeof Anthropic } & typeof Anthropic;
  return mod.default ?? mod;
}

async function viaApi(task: AssistantTask, target: Target, signal?: AbortSignal): Promise<AssistantAnswer> {
  const key = anthropicKey();
  if (!key) throw new Error('No Anthropic API key. Run wp-shakedown key set anthropic, or set ANTHROPIC_API_KEY.');
  const Anthropic = await loadSdk();
  const client = new Anthropic({ apiKey: key, timeout: TIMEOUT_MS });
  try {
    const res = await client.beta.messages.create(
      {
        model: 'claude-opus-5-5',
        max_tokens: 16000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { format: { type: 'json_schema', schema: ANSWER_SCHEMA as unknown as { [key: string]: unknown } } },
        messages: [{ role: 'user', content: withFiles(task, target) }],
      },
      signal ? { signal } : {},
    );
    if (res.stop_reason === 'refusal') throw new Error('The model declined this check.');
    const block = res.content.find((b) => b.type === 'text');
    return parseAnswer(task.id, block && 'text' in block ? block.text : '');
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) throw new Error('The API key was refused.');
    if (err instanceof Anthropic.RateLimitError) throw new Error('The API rate limit is reached. Try again in a minute.');
    if (err instanceof Anthropic.APIError) throw new Error(`The API failed: ${err.message}`.slice(0, 300));
    throw err;
  }
}

/** Asks one provider one check. Never throws: a failure becomes an `unsure` answer with the error. */
export async function ask(provider: AssistantProvider, task: AssistantTask, target: Target, signal?: AbortSignal): Promise<AssistantAnswer> {
  try {
    if (provider === 'claude') return await viaClaude(task, target, signal);
    if (provider === 'codex') return await viaCodex(task, target, signal);
    return await viaApi(task, target, signal);
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    const error =
      e.code === 'ENOENT' && provider !== 'api'
        ? NOT_INSTALLED[provider]
        : e.name === 'AbortError' || e.name === 'TimeoutError'
          ? 'The check was stopped or took longer than 10 minutes.'
          : e.message || String(err);
    return { check: task.id, verdict: 'unsure', findings: [], error };
  }
}
