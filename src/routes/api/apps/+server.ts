import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createApp } from '#lib/server/repo.ts';
import { toAppName } from '#lib/appname.ts';

export const POST: RequestHandler = async ({ request }) => {
	const { name, color } = (await request.json()) as { name: string; color?: string };
	const clean = toAppName(name ?? '');
	if (!clean) error(400, 'App names use a–z, 0–9, dot, dash or underscore');
	await createApp(clean, color);
	return json({ ok: true, name: clean });
};
