<?php
add_action( 'wp_enqueue_scripts', function () {
	wp_enqueue_style( 'case-font', 'https://fonts.googleapis.com/css2?family=Inter', array(), null );
} );
