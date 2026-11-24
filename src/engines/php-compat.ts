import { requiresPhp } from '../php/files.ts';
import { runPhpcs } from '../php/phpcs.ts';
import type { Engine } from '../types.ts';

export const phpCompat: Engine = {
  id: 'php-compat',
  title: 'PHP compatibility',
  kinds: ['theme', 'plugin'],
  async run({ target, signal, note }) {
    const declared = requiresPhp(target.path);
    const min = declared ?? '7.4';
    note(declared ? `Checking against PHP ${min} and newer.` : 'No "Requires PHP" header found. Checking against PHP 7.4 and newer.');
    const messages = await runPhpcs({
      target,
      standard: 'PHPCompatibilityWP',
      extra: ['--runtime-set', 'testVersion', `${min}-`],
      ...(signal ? { signal } : {}),
      note,
    });
    return messages.map((m) => ({
      rule: m.source,
      severity: m.type === 'ERROR' ? 'error' : 'warning',
      category: 'compatibility',
      message: m.message,
      location: { file: m.file, line: m.line, column: m.column },
    }));
  },
};
