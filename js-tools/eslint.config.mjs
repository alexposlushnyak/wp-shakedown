import wordpress from '@wordpress/eslint-plugin';
import globals from 'globals';

export default [
	{ ignores: [ '**/node_modules/**', '**/vendor/**', '**/bower_components/**', '**/build/**', '**/dist/**', '**/*.min.js' ] },
	...wordpress.configs.recommended,
	// ESLint only lints the extensions a config names. Without this entry a .jsx file is skipped without a word.
	{ files: [ '**/*.jsx' ] },
	{
		languageOptions: {
			globals: { ...globals.browser, ...globals.jquery, wp: 'readonly', ajaxurl: 'readonly', _: 'readonly', Backbone: 'readonly' },
		},
		rules: {
			'prettier/prettier': 'off',
			'import/no-extraneous-dependencies': 'off',
			'import/no-unresolved': 'off',
		},
	},
];
