import type { Profile, Target, TargetKind } from './types.ts';

export const profiles: Profile[] = [
  {
    id: 'wporg-theme',
    title: 'WordPress.org theme directory',
    summary: 'What the theme directory of wordpress.org checks before a review: Theme Check, PHP that parses, the WordPress standards and theme.json. With experimental checks on, also what reviewers ask for most.',
    kinds: ['theme'],
    engines: ['php-lint', 'theme-check', 'theme-review', 'wpcs', 'php-compat', 'wp-json'],
  },
  {
    id: 'envato',
    title: 'ThemeForest',
    summary: 'What Envato checks on a theme for ThemeForest: its own version of Theme Check, PHP that parses, the WordPress standards and theme.json.',
    kinds: ['theme'],
    engines: ['php-lint', 'theme-check', 'wpcs', 'php-compat', 'wp-json'],
  },
  {
    id: 'wporg-plugin',
    title: 'WordPress.org plugin directory',
    summary: 'What the plugin directory of wordpress.org checks in code: PHP that parses, the Plugin Check review rules and PHP versions.',
    kinds: ['plugin'],
    engines: ['php-lint', 'wpcs', 'php-compat'],
  },
  {
    id: 'site',
    title: 'WordPress site',
    summary: 'Whether a WordPress folder is intact, current and safe to run. Leaves out code style in themes and plugins.',
    kinds: ['install'],
    engines: ['integrity', 'updates', 'vulnerabilities', 'config', 'site-health', 'php-lint', 'php-compat'],
  },
];

const KIND: Record<TargetKind, string> = { theme: 'a theme', plugin: 'a plugin', install: 'a WordPress folder', url: 'a site URL' };

/** The engine IDs a profile runs on this target. Throws when the profile is unknown or does not fit the target. */
export function profileEngines(id: string, target: Target): string[] {
  const profile = profiles.find((p) => p.id === id);
  if (!profile) throw new Error(`Unknown profile "${id}". Known profiles: ${profiles.map((p) => p.id).join(', ')}.`);
  if (!profile.kinds.includes(target.kind)) {
    throw new Error(`The ${id} profile checks ${profile.kinds.map((k) => KIND[k]).join(' or ')}. "${target.name}" is ${KIND[target.kind]}.`);
  }
  return [...profile.engines];
}
