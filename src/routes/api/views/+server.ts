import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { saveView, VIEW_NAME_MAX } from '#lib/server/views.ts';
import { requireUser } from '#lib/server/session.ts';

/** { name, query } where query is the list's query string ("?app=shop…" or "") */
export const POST: RequestHandler = async ({ request, locals }) => {
	const body = (await request.json()) as { name?: string; query?: string };
	const name = String(body.name ?? '')
		.trim()
		.slice(0, VIEW_NAME_MAX);
	const query = String(body.query ?? '');
	if (!name) error(400, 'Give the view a name');
	if (query && !query.startsWith('?')) error(400, 'Invalid view query');
	await saveView(requireUser(locals).id, name, query);
	return json({ ok: true });
};
