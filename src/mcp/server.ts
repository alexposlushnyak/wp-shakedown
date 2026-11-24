import { createInterface } from 'node:readline';
import { Ajv } from 'ajv';
import type { Engine } from '../types.ts';
import { VERSION } from '../version.ts';
import { tools } from './tools.ts';

export interface McpOptions {
  engines: Engine[];
  input: NodeJS.ReadableStream;
  output: NodeJS.WritableStream;
}

const VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const INSTRUCTIONS = 'Call run_checks with the folder of a theme, a plugin or a WordPress site. Fix the errors first. Call run_checks again to confirm that they are gone.';

type Msg = { id?: string | number | null; method?: string; params?: Record<string, any> };

const ajv = new Ajv({ strict: false, allErrors: true });
const validators = new Map(tools.map((t) => [t.name, ajv.compile(t.inputSchema)]));

export function startMcp(opts: McpOptions): { closed: Promise<void> } {
  const running = new Map<string | number, AbortController>();
  const send = (m: object): void => {
    opts.output.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\n');
  };
  const reply = (id: Msg['id'], result: unknown): void => send({ id, result });
  const fail = (id: Msg['id'], code: number, message: string): void => send({ id, error: { code, message } });
  const text = (s: string, isError = false) => ({ content: [{ type: 'text', text: s }], ...(isError ? { isError } : {}) });

  async function call(id: string | number, params: NonNullable<Msg['params']>): Promise<void> {
    const tool = tools.find((t) => t.name === params.name);
    if (!tool) return fail(id, -32602, `Unknown tool: ${params.name}`);
    const args = (params.arguments ?? {}) as Record<string, unknown>;
    const validate = validators.get(tool.name)!;
    if (!validate(args)) return reply(id, text(`Invalid arguments: ${ajv.errorsText(validate.errors)}`, true));
    const ac = new AbortController();
    running.set(id, ac);
    const token = params._meta?.progressToken;
    const progress = (done: number, total: number, message: string): void => {
      if (token !== undefined) send({ method: 'notifications/progress', params: { progressToken: token, progress: done, total, message } });
    };
    try {
      reply(id, text(await tool.handler(args, { engines: opts.engines, signal: ac.signal, progress })));
    } catch (err) {
      reply(id, text(err instanceof Error ? err.message : String(err), true));
    } finally {
      running.delete(id);
    }
  }

  function handle(m: Msg): void {
    if (m.id === undefined) {
      if (m.method === 'notifications/cancelled') running.get(m.params?.requestId)?.abort();
      return;
    }
    const { id, params = {} } = m;
    switch (m.method) {
      case 'initialize':
        return reply(id, {
          protocolVersion: VERSIONS.includes(params.protocolVersion) ? params.protocolVersion : '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: 'wp-shakedown', version: VERSION },
          instructions: INSTRUCTIONS,
        });
      case 'ping':
        return reply(id, {});
      case 'tools/list':
        return reply(id, { tools: tools.map(({ name, title, description, inputSchema, annotations }) => ({ name, title, description, inputSchema, annotations })) });
      case 'tools/call':
        // Not awaited: the next line is read while the tool runs.
        void call(id as string | number, params);
        return;
      default:
        return fail(id, -32601, `Method not found: ${m.method}`);
    }
  }

  const rl = createInterface({ input: opts.input });
  rl.on('line', (line) => {
    if (!line.trim()) return;
    let data: unknown;
    try {
      data = JSON.parse(line);
    } catch {
      return fail(null, -32700, 'Parse error');
    }
    for (const m of Array.isArray(data) ? data : [data]) {
      if (m && typeof m === 'object') handle(m as Msg);
    }
  });
  const closed = new Promise<void>((resolve) =>
    rl.on('close', () => {
      for (const ac of running.values()) ac.abort();
      resolve();
    }),
  );
  return { closed };
}
