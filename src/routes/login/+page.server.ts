import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
	clearFailures,
	createSession,
	isThrottled,
	login,
	recordFailure,
	userCount
} from '#lib/server/auth.ts';
import { setSessionCookie } from '#lib/server/session.ts';
import { safeNext } from '#lib/server/validate.ts';

export const load: PageServerLoad = async ({ locals, url }) => {
	if (locals.user) redirect(303, safeNext(url.searchParams.get('next')));
	if ((await userCount()) === 0) redirect(303, '/setup');
};

export const actions: Actions = {
	default: async ({ request, cookies, url, getClientAddress }) => {
		const form = await request.formData();
		const email = String(form.get('email') ?? '').trim();
		const password = String(form.get('password') ?? '');
		const key = `${getClientAddress()}|${email.toLowerCase()}`;
		if (isThrottled(key))
			return fail(429, { email, message: 'Too many attempts — try again in 15 minutes' });

		const userId = await login(email, password);
		if (!userId) {
			recordFailure(key);
			return fail(400, { email, message: 'Wrong email or password' });
		}
		clearFailures(key);
		const { token, expires } = await createSession(userId);
		setSessionCookie(cookies, url, token, expires);
		redirect(303, safeNext(url.searchParams.get('next')));
	}
};
