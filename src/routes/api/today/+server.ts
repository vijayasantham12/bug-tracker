import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '#lib/server/session.ts';
import { addToToday, removeFromToday, reorderToday } from '#lib/server/today.ts';

const validId = (id: unknown): id is number =>
	typeof id === 'number' && Number.isInteger(id) && id > 0 && id <= 2147483647;

async function readBody(request: Request): Promise<Record<string, unknown>> {
	const body = await request.json().catch(() => error(400, 'Invalid JSON'));
	if (!body || typeof body !== 'object' || Array.isArray(body)) error(400, 'Invalid request');
	return body;
}

export const POST: RequestHandler = async ({ locals, request }) => {
	const user = requireUser(locals);
	const { issueId } = await readBody(request);
	if (!validId(issueId)) error(400, 'Invalid issue ID');
	await addToToday(user.id, issueId);
	return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ locals, request }) => {
	const user = requireUser(locals);
	const { issueId } = await readBody(request);
	if (!validId(issueId)) error(400, 'Invalid issue ID');
	await removeFromToday(user.id, issueId);
	return json({ ok: true });
};

export const PATCH: RequestHandler = async ({ locals, request }) => {
	const user = requireUser(locals);
	const { ids } = await readBody(request);
	if (!Array.isArray(ids) || !ids.every(validId) || new Set(ids).size !== ids.length)
		error(400, 'Expected a list of unique issue IDs');
	await reorderToday(user.id, ids);
	return json({ ok: true });
};
