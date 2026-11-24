export default {
	extends: [ '@wordpress/stylelint-config' ],
	overrides: [ { files: [ '**/*.scss' ], extends: [ '@wordpress/stylelint-config/scss' ] } ],
};
