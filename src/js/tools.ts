import { npmTools } from '../npm-tools.ts';

const tools = npmTools({
  folder: 'js-tools',
  files: ['package.json', 'package-lock.json', 'eslint.config.mjs', 'stylelint.config.mjs'],
  hashed: ['package-lock.json', 'eslint.config.mjs', 'stylelint.config.mjs'],
  prefix: 'js',
  ready: 'node_modules/eslint/package.json',
  what: 'ESLint and Stylelint',
  installing: 'Installing the JavaScript and CSS tools. This happens once.',
});

export function resetJsToolsCache(): void {
  tools.reset();
}

/** The folder that holds node_modules with ESLint and Stylelint. Installs it on first use. */
export function jsTools(note: (m: string) => void): Promise<string> {
  return tools.get(note);
}
