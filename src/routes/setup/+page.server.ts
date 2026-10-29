import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { createFirstAdmin, createSession, userCount } from '#lib/server/auth.ts';
import { setSessionCookie } from '#lib/server/session.ts';
import { readAccountForm } from '#lib/server/validate.ts';

export const load: PageServerLoad = async () => {
	if ((await userCount()) > 0) redirect(303, '/login');
};

export const actions: Actions = {
	default: async ({ request, cookies, url }) => {
		const { email, name, password, message } = readAccountForm(await request.formData());
		if (message) return fail(400, { email, name, message });
		const id = await createFirstAdmin(email, name, password);
		if (!id) redirect(303, '/login');
		const { token, expires } = await createSession(id);
		setSessionCookie(cookies, url, token, expires);
		redirect(303, '/');
	}
};
