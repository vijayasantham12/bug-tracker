import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { deleteMilestone, MILESTONE_NAME_MAX, updateMilestone } from '#lib/server/repo.ts';
import type { Milestone } from '#lib/types.ts';

export const PATCH: RequestHandler = async ({ params, request }) => {
	const patch = (await request.json()) as Partial<Milestone>;
	if ('name' in patch) {
		patch.name = patch.name?.trim().slice(0, MILESTONE_NAME_MAX);
		if (!patch.name) error(400, 'Milestone name is empty');
	}
	if ('dueDate' in patch) patch.dueDate = patch.dueDate || null;
	try {
		await updateMilestone(Number(params.id), patch);
	} catch (e) {
		if ((e as { code?: string }).code === '23505') error(409, 'Another milestone has that name');
		throw e;
	}
	return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ params }) => {
	await deleteMilestone(Number(params.id));
	return json({ ok: true });
};
