import type { Engine } from '../types.ts';
import { phpCompat } from './php-compat.ts';
import { phpLint } from './php-lint.ts';
import { phpstan } from './phpstan.ts';
import { wpJson } from './wp-json.ts';
import { wpcs } from './wpcs.ts';

export const engines: Engine[] = [phpLint, wpcs, phpCompat, phpstan, wpJson];
