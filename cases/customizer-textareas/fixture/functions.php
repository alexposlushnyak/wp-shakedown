<?php
add_action( 'customize_register', function ( $wp_customize ) {
	$wp_customize->add_control( 'case_a', array( 'section' => 'title_tagline', 'type' => 'textarea' ) );
	$wp_customize->add_control( 'case_b', array( 'section' => 'title_tagline', 'type' => 'textarea' ) );
	$wp_customize->add_control( 'case_c', array( 'section' => 'title_tagline', 'type' => 'textarea' ) );
	$wp_customize->add_control( 'case_d', array( 'section' => 'title_tagline', 'type' => 'textarea' ) );
} );
