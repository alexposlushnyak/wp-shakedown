import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, test } from 'node:test';
import './env.ts';
import { eslint } from '../src/engines/eslint.ts';
import { stylelint } from '../src/engines/stylelint.ts';
import { exec } from '../src/exec.ts';
import { run } from '../src/runner.ts';
import { detectTarget } from '../src/target.ts';
import type { RunEvent } from '../src/types.ts';
import { makePlugin, makeTheme, tmp, write } from './helpers.ts';

const available = await exec('npm', ['--version']).then((r) => r.code === 0, () => false);
const opts = { timeout: 300000, ...(available ? {} : { skip: 'npm is needed' }) };

const MAIN = `jQuery( function ( $ ) {
	$( '.x' ).on( 'click', function () {
		var a = myLocalized.url;
		if ( a == 1 ) {
			wp.ajax.post( ajaxurl );
		}
	} );
} );
`;

describe('js engines', opts, () => {
  test('eslint and stylelint report the fixture theme', opts, async (t) => {
    const dir = makeTheme(tmp(t));
    write(path.join(dir, 'assets/js/main.js'), MAIN);
    write(path.join(dir, 'assets/js/broken.js'), 'function broken( {\n');
    write(path.join(dir, 'build/index.min.js'), '!function(){var a=1;a==2&&b()}();\n');
    write(path.join(dir, 'src/edit.jsx'), 'export default function Edit() {\n\treturn <img src="x.png" />;\n}\n');
    write(path.join(dir, 'assets/js/bundle.js'), 'var z = 1;\n//# sourceMappingURL=bundle.js.map\n');
    write(path.join(dir, 'assets/css/style.css'), '.Card { color: #ggg; colr: red; }\na { }\n');
    write(path.join(dir, 'assets/css/compiled.css'), '.a{color:red}\n/*# sourceMappingURL=compiled.css.map */\n');
    const r = await run(detectTarget(dir), { engines: [eslint, stylelint] });
    assert.deepEqual(r.engines.map((e) => e.status), ['ok', 'ok'], JSON.stringify(r.engines));

    const js = r.findings.filter((f) => f.engine === 'eslint');
    const undef = js.find((f) => f.rule === 'no-undef' && f.location.file === 'assets/js/main.js');
    assert.ok(undef && undef.message.includes('myLocalized') && undef.severity === 'warning', JSON.stringify(js));
    assert.ok(!js.some((f) => f.rule === 'no-undef' && /jQuery|\bwp\b|ajaxurl/.test(f.message)), JSON.stringify(js));
    const noVar = js.find((f) => f.rule === 'no-var');
    assert.ok(noVar && noVar.severity === 'info' && noVar.category === 'standards');
    assert.ok(js.some((f) => f.rule === 'syntax' && f.severity === 'error' && f.location.file === 'assets/js/broken.js'));
    assert.ok(!js.some((f) => f.location.file === 'build/index.min.js' || f.location.file === 'assets/js/bundle.js'));
    // A .jsx file is linted only because the config names the extension.
    const alt = js.find((f) => f.rule === 'jsx-a11y/alt-text');
    assert.ok(alt && alt.location.file === 'src/edit.jsx' && alt.category === 'accessibility' && alt.severity === 'warning', JSON.stringify(js));

    const css = r.findings.filter((f) => f.engine === 'stylelint');
    const unknown = css.find((f) => f.rule === 'property-no-unknown' && f.location.file === 'assets/css/style.css');
    assert.ok(unknown && unknown.severity === 'warning' && !unknown.message.endsWith(')'), JSON.stringify(css));
    assert.ok(css.some((f) => f.rule === 'declaration-property-value-no-unknown' && f.message.includes('#ggg')));
    assert.ok(css.some((f) => f.category === 'standards' && f.severity === 'info'));
    assert.ok(!css.some((f) => f.location.file === 'assets/css/compiled.css'));
  });

  test('a plugin with no JavaScript or CSS installs nothing and reports nothing', async (t) => {
    const dir = makePlugin(tmp(t));
    const events: RunEvent[] = [];
    const r = await run(detectTarget(dir), { engines: [eslint, stylelint], onEvent: (e) => events.push(e) });
    assert.deepEqual(r.engines.map((e) => [e.status, e.findings]), [['ok', 0], ['ok', 0]]);
    assert.ok(!events.some((e) => e.type === 'engine:note'));
  });
});
