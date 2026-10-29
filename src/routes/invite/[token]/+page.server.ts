import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { acceptInvite, createSession, getInvite } from '#lib/server/auth.ts';
import { setSessionCookie } from '#lib/server/session.ts';
import { readAccountForm } from '#lib/server/validate.ts';

export const load: PageServerLoad = async ({ params, locals }) => {
	const invite = await getInvite(params.token);
	return {
		invite: invite && { email: invite.email, role: invite.role },
		signedInAs: locals.user?.email ?? null
	};
};

export const actions: Actions = {
	default: async ({ params, request, cookies, url }) => {
		const invite = await getInvite(params.token);
		if (!invite)
			return fail(410, { email: '', name: '', message: 'This invite is no longer valid' });
		const form = await request.formData();
		// an invite made for a specific email can only be used with that email
		if (invite.email) form.set('email', invite.email);
		const { email, name, password, message } = readAccountForm(form);
		if (message) return fail(400, { email, name, message });

		const userId = await acceptInvite(params.token, email, name, password);
		if (!userId)
			return fail(400, {
				email,
				name,
				message: 'That email already has an account, or the invite was just used'
			});
		const { token, expires } = await createSession(userId);
		setSessionCookie(cookies, url, token, expires);
		redirect(303, '/');
	}
};
