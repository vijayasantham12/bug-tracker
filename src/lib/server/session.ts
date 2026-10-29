import { error, type Cookies } from '@sveltejs/kit';
import { SESSION_COOKIE } from './auth';
import type { User } from '#lib/types.ts';

export function setSessionCookie(cookies: Cookies, url: URL, token: string, expires: Date) {
	cookies.set(SESSION_COOKIE, token, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: url.protocol === 'https:',
		expires
	});
}

export function clearSessionCookie(cookies: Cookies) {
	cookies.delete(SESSION_COOKIE, { path: '/' });
}

export function requireUser(locals: App.Locals): User {
	if (!locals.user) error(401, 'Not signed in');
	return locals.user;
}

export function requireAdmin(locals: App.Locals): User {
	const user = requireUser(locals);
	if (user.role !== 'admin') error(403, 'Admins only');
	return user;
}
