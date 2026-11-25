<?php
/**
 * Runs the Theme Check checks without WordPress.
 *
 * Usage: php theme-check.php <theme-check folder> <theme folder>
 * Prints JSON: { "messages": [ { "check", "html" } ], "missingParent": string|null }.
 *
 * The checks read the theme as text and call a few WordPress functions.
 * This file gives them those functions and a stand-in for WP_Theme.
 * It never loads a file of the theme as code.
 */

// A WordPress function that this file does not define ends the run with a fatal error, and the engine reports it.
error_reporting( E_ERROR | E_PARSE | E_CORE_ERROR | E_COMPILE_ERROR );
ini_set( 'display_errors', 'stderr' );

if ( $argc < 3 || ! is_file( $argv[1] . '/checkbase.php' ) || ! is_dir( $argv[2] ) ) {
	fwrite( STDERR, "Usage: php theme-check.php <theme-check folder> <theme folder>\n" );
	exit( 2 );
}

define( 'KB_IN_BYTES', 1024 );
define( 'MB_IN_BYTES', 1024 * KB_IN_BYTES );
define( 'GB_IN_BYTES', 1024 * MB_IN_BYTES );

function __( $text ) {
	return $text;
}

function _x( $text ) {
	return $text;
}

function esc_html__( $text ) {
	return esc_html( $text );
}

function apply_filters( $hook, $value ) {
	return $value;
}

function do_action() {}

function esc_html( $text ) {
	return htmlspecialchars( (string) $text, ENT_QUOTES, 'UTF-8' );
}

function esc_url( $url ) {
	return str_replace( array( '"', "'", '<', '>', ' ' ), array( '%22', '%27', '%3C', '%3E', '%20' ), (string) $url );
}

function wp_strip_all_tags( $text ) {
	return trim( strip_tags( preg_replace( '@<(script|style)[^>]*?>.*?</\\1>@si', '', (string) $text ) ) );
}

function sanitize_title_with_dashes( $title ) {
	$title = strtolower( strip_tags( (string) $title ) );
	$title = preg_replace( '/&.+?;/', '', $title );
	$title = str_replace( '.', '-', $title );
	$title = preg_replace( '/[^%a-z0-9 _-]/', '', $title );
	$title = preg_replace( '/\s+/', '-', $title );
	return trim( preg_replace( '/-+/', '-', $title ), '-' );
}

function size_format( $bytes, $decimals = 0 ) {
	foreach ( array( 'GB' => GB_IN_BYTES, 'MB' => MB_IN_BYTES, 'KB' => KB_IN_BYTES, 'B' => 1 ) as $unit => $size ) {
		if ( $bytes >= $size ) {
			return number_format( $bytes / $size, $decimals ) . ' ' . $unit;
		}
	}
	return '0 B';
}

// shortcut: the type comes from the extension alone. WordPress also reads the file. The checks only ask whether a file is an image.
function wp_check_filetype_and_ext( $file, $filename ) {
	$types = array(
		'jpg'  => 'image/jpeg',
		'jpeg' => 'image/jpeg',
		'jpe'  => 'image/jpeg',
		'png'  => 'image/png',
		'gif'  => 'image/gif',
		'bmp'  => 'image/bmp',
		'tif'  => 'image/tiff',
		'tiff' => 'image/tiff',
		'webp' => 'image/webp',
		'avif' => 'image/avif',
		'ico'  => 'image/x-icon',
	);
	$ext   = strtolower( pathinfo( $filename, PATHINFO_EXTENSION ) );
	$known = isset( $types[ $ext ] );
	return array(
		'ext'             => $known ? $ext : false,
		'type'            => $known ? $types[ $ext ] : false,
		'proper_filename' => false,
	);
}

function get_file_data( $file, $headers ) {
	$data = str_replace( "\r", "\n", (string) file_get_contents( $file, false, null, 0, 8 * KB_IN_BYTES ) );
	$out  = array();
	foreach ( $headers as $field => $name ) {
		$found         = preg_match( '/^(?:[ \t]*<\?php)?[ \t\/*#@]*' . preg_quote( $name, '/' ) . ':(.*)$/mi', $data, $match ) && $match[1];
		$out[ $field ] = $found ? trim( preg_replace( '/\s*(?:\*\/|\?>).*/', '', $match[1] ) ) : '';
	}
	return $out;
}

/** What the checks use of WP_Theme: the headers of style.css and the list of files. */
class WP_Theme implements ArrayAccess {
	const HEADERS = array(
		'Name'        => 'Theme Name',
		'ThemeURI'    => 'Theme URI',
		'Description' => 'Description',
		'Author'      => 'Author',
		'AuthorURI'   => 'Author URI',
		'Version'     => 'Version',
		'Template'    => 'Template',
		'Status'      => 'Status',
		'Tags'        => 'Tags',
		'TextDomain'  => 'Text Domain',
		'DomainPath'  => 'Domain Path',
		'RequiresWP'  => 'Requires at least',
		'RequiresPHP' => 'Requires PHP',
		'UpdateURI'   => 'Update URI',
	);

	private $dir;
	private $headers;

	public function __construct( $dir ) {
		$this->dir     = $dir;
		$this->headers = is_file( $dir . '/style.css' ) ? get_file_data( $dir . '/style.css', self::HEADERS ) : array_fill_keys( array_keys( self::HEADERS ), '' );
	}

	public function get( $header ) {
		if ( ! isset( $this->headers[ $header ] ) ) {
			return false;
		}
		if ( 'Tags' === $header ) {
			return array_values( array_filter( array_map( 'trim', explode( ',', strip_tags( $this->headers['Tags'] ) ) ) ) );
		}
		return $this->headers[ $header ];
	}

	public function get_stylesheet_directory() {
		return $this->dir;
	}

	/** The folder of the parent theme, whether it exists or not. Null for a theme that has no parent. */
	private function parent_dir() {
		$template = $this->headers['Template'];
		return '' === $template || basename( $this->dir ) === $template ? null : dirname( $this->dir ) . DIRECTORY_SEPARATOR . $template;
	}

	/** The checks only ask whether there is a parent. */
	public function parent() {
		return null !== $this->parent_dir();
	}

	public function missing_parent() {
		$parent = $this->parent_dir();
		return null === $parent || is_dir( $parent ) ? null : $this->headers['Template'];
	}

	/** Relative path => absolute path. The files of the parent theme come after the theme's own, as in WordPress. */
	public function get_files( $type = null, $depth = 0, $search_parent = false ) {
		$files  = self::scan( $this->dir, '' );
		$parent = $this->parent_dir();
		if ( $search_parent && null !== $parent && is_dir( $parent ) ) {
			$files += self::scan( $parent, '' );
		}
		return $files;
	}

	// Skips what WordPress skips: names that start with a dot and the folders of package managers.
	private static function scan( $dir, $prefix ) {
		$files = array();
		foreach ( (array) scandir( $dir ) as $name ) {
			if ( ! is_string( $name ) || '.' === $name[0] || in_array( $name, array( 'CVS', 'node_modules', 'vendor', 'bower_components' ), true ) ) {
				continue;
			}
			$path = $dir . DIRECTORY_SEPARATOR . $name;
			if ( is_link( $path ) ) {
				continue;
			}
			if ( is_dir( $path ) ) {
				$files += self::scan( $path, $prefix . $name . '/' );
			} elseif ( is_file( $path ) ) {
				$files[ $prefix . $name ] = $path;
			}
		}
		return $files;
	}

	#[\ReturnTypeWillChange]
	public function offsetExists( $offset ) {
		return isset( $this->headers[ $offset ] );
	}

	#[\ReturnTypeWillChange]
	public function offsetGet( $offset ) {
		return $this->get( $offset );
	}

	#[\ReturnTypeWillChange]
	public function offsetSet( $offset, $value ) {}

	#[\ReturnTypeWillChange]
	public function offsetUnset( $offset ) {}
}

$dir = realpath( $argv[2] );
require $argv[1] . '/checkbase.php';

$theme = new WP_Theme( $dir );
ob_start();
run_themechecks_against_theme( $theme, basename( $dir ) );
ob_end_clean();

$messages = array();
foreach ( $themechecks as $check ) {
	if ( ! $check instanceof themecheck ) {
		continue;
	}
	foreach ( (array) $check->getError() as $html ) {
		$messages[] = array(
			'check' => get_class( $check ),
			'html'  => (string) $html,
		);
	}
}

echo json_encode(
	array(
		'messages'      => $messages,
		'missingParent' => $theme->missing_parent(),
	),
	JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE
);
