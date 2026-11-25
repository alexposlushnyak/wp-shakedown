<?php
/**
 * Runs Site Health tests of WordPress and prints the results as JSON.
 *
 * Run it with WP-CLI: wp eval-file site-health.php
 *
 * Only tests that read are listed. The script also runs them inside a database
 * transaction and rolls it back, so a test that stores a transient leaves nothing.
 */

// Tests of WP_Site_Health that read the site and ask no other server.
$wp_shakedown_tests = array(
	'php_extensions',
	'php_default_timezone',
	'php_sessions',
	'sql_server',
	'ssl_support',
	'scheduled_events',
	'debug_enabled',
	'file_uploads',
	'plugin_version',
	'theme_version',
	'autoloaded_options',
	'persistent_object_cache',
);

global $wpdb;
$wpdb->query( 'START TRANSACTION' );

require_once ABSPATH . 'wp-admin/includes/admin.php';
require_once ABSPATH . 'wp-admin/includes/class-wp-site-health.php';

$wp_shakedown_health = WP_Site_Health::get_instance();
$wp_shakedown_direct = WP_Site_Health::get_tests()['direct'];
$wp_shakedown_out    = array();

foreach ( $wp_shakedown_tests as $wp_shakedown_name ) {
	if ( ! isset( $wp_shakedown_direct[ $wp_shakedown_name ] ) ) {
		continue;
	}
	$wp_shakedown_test = $wp_shakedown_direct[ $wp_shakedown_name ]['test'];
	if ( is_string( $wp_shakedown_test ) && method_exists( $wp_shakedown_health, 'get_test_' . $wp_shakedown_test ) ) {
		$wp_shakedown_test = array( $wp_shakedown_health, 'get_test_' . $wp_shakedown_test );
	}
	if ( ! is_callable( $wp_shakedown_test ) ) {
		continue;
	}
	try {
		$wp_shakedown_result = call_user_func( $wp_shakedown_test );
	} catch ( Throwable $e ) {
		$wp_shakedown_out[] = array(
			'test'   => $wp_shakedown_name,
			'status' => 'error',
			'label'  => $e->getMessage(),
		);
		continue;
	}
	if ( ! is_array( $wp_shakedown_result ) ) {
		continue;
	}
	$wp_shakedown_out[] = array(
		'test'        => $wp_shakedown_name,
		'status'      => isset( $wp_shakedown_result['status'] ) ? (string) $wp_shakedown_result['status'] : '',
		'label'       => isset( $wp_shakedown_result['label'] ) ? (string) $wp_shakedown_result['label'] : '',
		'description' => isset( $wp_shakedown_result['description'] ) ? (string) $wp_shakedown_result['description'] : '',
	);
}

$wpdb->query( 'ROLLBACK' );

echo wp_json_encode(
	array(
		'wordpress' => get_bloginfo( 'version' ),
		'tests'     => $wp_shakedown_out,
	)
);
