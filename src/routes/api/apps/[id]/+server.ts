import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { deleteApp, updateApp } from '#lib/server/repo.ts';
import { toAppName } from '#lib/appname.ts';
import type { App } from '#lib/types.ts';

export const PATCH: RequestHandler = async ({ params, request }) => {
	const patch = (await request.json()) as Partial<App>;
	if ('name' in patch && !toAppName(patch.name ?? ''))
		error(400, 'App names use a–z, 0–9, dot, dash or underscore');
	try {
		await updateApp(Number(params.id), patch);
	} catch (e) {
		// unique index on lower(name)
		if ((e as { code?: string }).code === '23505') error(409, 'Another app already has that name');
		throw e;
	}
	return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ params }) => {
	if (!(await deleteApp(Number(params.id))))
		error(409, 'App still has issues — archive it instead');
	return json({ ok: true });
};
