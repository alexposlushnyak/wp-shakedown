import type { Engine } from '../types.ts';
import { activationLock } from './activation-lock.ts';
import { config } from './config.ts';
import { eslint } from './eslint.ts';
import { integrity } from './integrity.ts';
import { phpCompat } from './php-compat.ts';
import { phpLint } from './php-lint.ts';
import { phpstan } from './phpstan.ts';
import { siteHealth } from './site-health.ts';
import { stylelint } from './stylelint.ts';
import { themeCheck } from './theme-check.ts';
import { themeReview } from './theme-review.ts';
import { updates } from './updates.ts';
import { vulnerabilities } from './vulnerabilities.ts';
import { wpJson } from './wp-json.ts';
import { wpcs } from './wpcs.ts';

export const engines: Engine[] = [phpLint, themeCheck, themeReview, wpcs, phpCompat, phpstan, wpJson, eslint, stylelint, integrity, updates, vulnerabilities, config, siteHealth, activationLock];
