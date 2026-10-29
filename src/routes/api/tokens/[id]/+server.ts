import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { deleteApiToken } from '#lib/server/auth.ts';
import { requireUser } from '#lib/server/session.ts';

export const DELETE: RequestHandler = async ({ params, locals }) => {
	await deleteApiToken(requireUser(locals).id, Number(params.id));
	return json({ ok: true });
};
