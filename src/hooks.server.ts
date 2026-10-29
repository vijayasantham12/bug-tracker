import type { Handle, ServerInit } from '@sveltejs/kit/hooks';
import { migrate, sql } from '#lib/server/db.ts';
import { startScheduler, stopScheduler } from '#lib/server/notify.ts';
import { SESSION_COOKIE, userCount, validateApiToken, validateSession } from '#lib/server/auth.ts';
import { clearSessionCookie, setSessionCookie } from '#lib/server/session.ts';

export const init: ServerInit = async () => {
	await migrate();
	// reminders and the daily digest
	startScheduler();
	// adapter-node emits this after draining HTTP on SIGTERM/SIGINT; the open pool would keep node alive
	process.once('sveltekit:shutdown', () => {
		stopScheduler();
		void sql.end({ timeout: 5 });
	});
};

const isPublic = (path: string) =>
	path === '/login' || path === '/setup' || path === '/healthz' || path.startsWith('/invite/');

export const handle: Handle = async ({ event, resolve }) => {
	const { cookies, url } = event;
	event.locals.user = null;

	const token = cookies.get(SESSION_COOKIE);
	if (token) {
		const session = await validateSession(token);
		if (session) {
			event.locals.user = session.user;
			if (session.expires) setSessionCookie(cookies, url, token, session.expires);
		} else {
			clearSessionCookie(cookies);
		}
	}

	// API tokens (iOS Shortcut, scripts) only open /api/*, never pages
	const bearer = /^Bearer (\S+)$/.exec(event.request.headers.get('authorization') ?? '')?.[1];
	if (!event.locals.user && bearer && url.pathname.startsWith('/api/')) {
		event.locals.user = await validateApiToken(bearer);
		if (!event.locals.user) return Response.json({ message: 'Invalid API token' }, { status: 401 });
	}

	if (!event.locals.user && !isPublic(url.pathname)) {
		if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/attachments/')) {
			return Response.json({ message: 'Not signed in' }, { status: 401 });
		}
		const location =
			(await userCount()) === 0
				? '/setup'
				: `/login?next=${encodeURIComponent(url.pathname + url.search)}`;
		return new Response(null, { status: 303, headers: { location } });
	}

	return resolve(event);
};
