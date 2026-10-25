<?php
add_action(
	'wp_enqueue_scripts',
	static function () {
		$theme_file = get_stylesheet_directory() . '/style.css';
		wp_enqueue_style(
			'urumi-storefront',
			get_stylesheet_uri(),
			array(),
			file_exists( $theme_file ) ? (string) filemtime( $theme_file ) : wp_get_theme()->get( 'Version' )
		);
	}
);
