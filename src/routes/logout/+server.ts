import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { deleteSession, SESSION_COOKIE } from '#lib/server/auth.ts';
import { clearSessionCookie } from '#lib/server/session.ts';

export const POST: RequestHandler = async ({ cookies }) => {
	const token = cookies.get(SESSION_COOKIE);
	if (token) await deleteSession(token);
	clearSessionCookie(cookies);
	redirect(303, '/login');
};
