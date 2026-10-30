import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readHillInput } from '#lib/server/hill-input.ts';
import { saveHillUpdate } from '#lib/server/hill.ts';
import { requireUser } from '#lib/server/session.ts';

export const POST: RequestHandler = async ({ params, request, locals }) => {
	const id = Number(params.id);
	if (!Number.isInteger(id) || id <= 0 || id > 2147483647) error(404, 'Milestone not found');
	const input = readHillInput(await request.json().catch(() => null));
	await saveHillUpdate(id, input, requireUser(locals).id);
	return json({ ok: true });
};
