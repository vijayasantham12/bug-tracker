import { beforeNavigate } from '$app/navigation';

/**
 * Asks before leaving while `isDirty()` is true. Refresh/close/external links get the
 * browser's own "Leave site?" dialog; in-app links get a confirm(). Navigations that stay
 * on the same path (e.g. changing list filters) don't lose anything and pass through.
 * Call during component init.
 */
export function guardUnsaved(
	isDirty: () => boolean,
	message = 'You have unsaved changes. Leave anyway?'
) {
	beforeNavigate((nav) => {
		if (!isDirty()) return;
		if (nav.willUnload) return nav.cancel();
		if (nav.to?.url.pathname === nav.from?.url.pathname) return;
		if (!confirm(message)) nav.cancel();
	});
}
