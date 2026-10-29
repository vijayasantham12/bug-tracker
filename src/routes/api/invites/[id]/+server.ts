import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { deleteInvite } from '#lib/server/auth.ts';
import { requireAdmin } from '#lib/server/session.ts';

export const DELETE: RequestHandler = async ({ params, locals }) => {
	requireAdmin(locals);
	await deleteInvite(Number(params.id));
	return json({ ok: true });
};
