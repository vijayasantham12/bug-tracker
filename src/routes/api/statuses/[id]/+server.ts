import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { deleteStatus, moveStatus, updateStatus } from '#lib/server/repo.ts';
import type { Status } from '#lib/types.ts';

/** Body is a partial status, or { move: -1 | 1 } to reorder. */
export const PATCH: RequestHandler = async ({ params, request }) => {
	const body = (await request.json()) as Partial<Status> & { move?: -1 | 1 };
	if (body.move) await moveStatus(Number(params.id), body.move);
	else await updateStatus(Number(params.id), body);
	return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ params }) => {
	if (!(await deleteStatus(Number(params.id))))
		error(409, 'Pick another default status before deleting this one');
	return json({ ok: true });
};
