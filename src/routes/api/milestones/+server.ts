import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createMilestone, MILESTONE_NAME_MAX } from '#lib/server/repo.ts';

export const POST: RequestHandler = async ({ request }) => {
	const { name, dueDate } = (await request.json()) as { name: string; dueDate?: string };
	const clean = name?.trim().slice(0, MILESTONE_NAME_MAX);
	if (!clean) error(400, 'Milestone name is empty');
	try {
		return json({ id: await createMilestone(clean, dueDate || null) });
	} catch (e) {
		if ((e as { code?: string }).code === '23505') error(409, 'That milestone already exists');
		throw e;
	}
};
