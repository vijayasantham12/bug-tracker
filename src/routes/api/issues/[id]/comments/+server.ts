import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { addComment, deleteComment } from '#lib/server/repo.ts';
import { requireUser } from '#lib/server/session.ts';
import { afterComment } from '#lib/server/notify.ts';

export const POST: RequestHandler = async ({ params, request, locals }) => {
	const { body } = (await request.json()) as { body: string };
	if (!body?.trim()) error(400, 'Empty comment');
	const user = requireUser(locals);
	await addComment(Number(params.id), body.trim(), user.id);
	afterComment(Number(params.id), body.trim(), user);
	return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ params, request, locals }) => {
	const { eventId } = (await request.json()) as { eventId: number };
	await deleteComment(Number(params.id), eventId, requireUser(locals));
	return json({ ok: true });
};
