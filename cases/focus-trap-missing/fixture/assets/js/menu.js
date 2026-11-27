const toggle = document.querySelector( '.menu-toggle' );
const menu = document.querySelector( '.main-navigation' );
toggle.addEventListener( 'click', () => {
	menu.classList.toggle( 'is-open' );
	toggle.setAttribute( 'aria-expanded', menu.classList.contains( 'is-open' ) );
} );
