import type { Engine } from '../types.ts';
import { phpCompat } from './php-compat.ts';
import { phpLint } from './php-lint.ts';
import { wpcs } from './wpcs.ts';

export const engines: Engine[] = [phpLint, wpcs, phpCompat];
