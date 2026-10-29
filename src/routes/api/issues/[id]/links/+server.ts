import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { addLink, cleanUrl, deleteLink } from '#lib/server/repo.ts';
import { requireUser } from '#lib/server/session.ts';

export const POST: RequestHandler = async ({ params, request, locals }) => {
	const { url, title } = (await request.json()) as { url: string; title?: string };
	const clean = cleanUrl(url ?? '');
	if (!clean) error(400, 'Enter an http(s) URL');
	await addLink(Number(params.id), clean, title?.trim() || null, requireUser(locals).id);
	return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ params, request, locals }) => {
	const { linkId } = (await request.json()) as { linkId: number };
	await deleteLink(Number(params.id), linkId, requireUser(locals).id);
	return json({ ok: true });
};
