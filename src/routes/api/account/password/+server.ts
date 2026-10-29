import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { changePassword, MIN_PASSWORD } from '#lib/server/auth.ts';
import { requireUser } from '#lib/server/session.ts';

export const POST: RequestHandler = async ({ request, locals }) => {
	const user = requireUser(locals);
	const { current, next } = (await request.json()) as { current: string; next: string };
	if (!next || next.length < MIN_PASSWORD)
		error(400, `New password must be at least ${MIN_PASSWORD} characters`);
	if (!(await changePassword(user.id, current ?? '', next)))
		error(400, 'Current password is wrong');
	return json({ ok: true });
};
