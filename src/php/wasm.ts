import { npmTools } from '../npm-tools.ts';

const tools = npmTools({
  folder: 'php-wasm',
  files: ['package.json', 'package-lock.json', 'php.mjs'],
  hashed: ['package-lock.json', 'php.mjs'],
  prefix: 'php-wasm',
  ready: 'node_modules/@php-wasm/node/package.json',
  what: 'the bundled PHP',
  installing: 'Installing the bundled PHP. This happens once and downloads about 160 MB.',
});

export function resetPhpWasmCache(): void {
  tools.reset();
}

/** The folder that holds php.mjs and its node_modules. Installs it on first use. */
export function phpWasm(note: (m: string) => void): Promise<string> {
  return tools.get(note);
}
