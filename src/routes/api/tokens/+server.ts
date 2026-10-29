import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createApiToken } from '#lib/server/auth.ts';
import { requireUser } from '#lib/server/session.ts';

/** { name } → { token }; the token is only ever returned here */
export const POST: RequestHandler = async ({ request, locals }) => {
	const { name } = (await request.json()) as { name: string };
	const clean = String(name ?? '')
		.trim()
		.slice(0, 60);
	if (!clean) error(400, 'Give the token a name, e.g. "iPhone shortcut"');
	return json({ token: await createApiToken(requireUser(locals).id, clean) });
};
