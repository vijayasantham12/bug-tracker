import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createStatus } from '#lib/server/repo.ts';

export const POST: RequestHandler = async ({ request }) => {
	const { name, isClosed } = (await request.json()) as { name: string; isClosed?: boolean };
	if (!name?.trim()) error(400, 'Name required');
	await createStatus(name.trim(), !!isClosed);
	return json({ ok: true });
};
