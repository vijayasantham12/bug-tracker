import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { deleteView } from '#lib/server/views.ts';
import { requireUser } from '#lib/server/session.ts';

export const DELETE: RequestHandler = async ({ params, locals }) => {
	await deleteView(requireUser(locals).id, Number(params.id));
	return json({ ok: true });
};
