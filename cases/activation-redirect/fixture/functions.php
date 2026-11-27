<?php
add_action( 'after_switch_theme', function () {
	wp_safe_redirect( admin_url( 'themes.php?page=case-welcome' ) );
	exit;
} );
