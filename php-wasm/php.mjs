// Runs `php <args>` on the WebAssembly PHP of WordPress Playground.
// Usage: node php.mjs <php args...>. Prints PHP's stdout and stderr and exits with PHP's exit code.
import { realpathSync } from 'node:fs';
import os from 'node:os';
import { PHP, sandboxedSpawnHandlerFactory } from '@php-wasm/universal';
import { loadNodeRuntime, useHostFilesystem } from '@php-wasm/node';

// The runtime throws without a process id.
let nextPid = 1;
const boot = async () => {
  const php = new PHP(await loadNodeRuntime('8.4', { emscriptenOptions: { processId: nextPid++ } }));
  useHostFilesystem(php);
  // Without a spawn handler, exec() and proc_open() in PHP hang forever.
  // The handler runs `php` in a nested instance and answers `tput cols`.
  const sandboxed = sandboxedSpawnHandlerFactory(async () => {
    const child = await boot();
    return { php: child, reap: () => { try { child.exit(); } catch {} } };
  });
  await php.setSpawnHandler((cmd, args) => sandboxed(cmd, args));
  return php;
};

const php = await boot();
// Paths below a symlinked top-level folder (/tmp, /var on macOS) do not resolve inside the runtime.
const tmp = realpathSync(os.tmpdir());
// The runtime logs every notice a second time and writes errors to stdout, which would break JSON output.
const res = await php.cli(
  ['php', '-d', `sys_temp_dir=${tmp}`, '-d', 'display_errors=stderr', '-d', 'log_errors=0', ...process.argv.slice(2)],
  // The shared bin folder first, so PHP_BINARY points at a PHP that the spawn handler can run.
  { cwd: realpathSync(process.cwd()), env: { ...process.env, PATH: `/internal/shared/bin:${process.env.PATH ?? ''}` } },
);
const [stdout, stderr, code] = await Promise.all([res.stdoutText, res.stderrText, res.exitCode]);
// Wait for the writes: a pipe can lose output when the process exits at once.
await new Promise((resolve) => process.stdout.write(stdout, resolve));
await new Promise((resolve) => process.stderr.write(stderr, resolve));
// The runtime keeps the event loop busy, so exit by hand.
process.exit(code);
