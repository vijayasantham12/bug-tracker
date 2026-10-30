import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getMilestone, listHillScopes, listHillUpdates } from '#lib/server/hill.ts';

export const load: PageServerLoad = async ({ params }) => {
	const id = Number(params.id);
	if (!Number.isInteger(id) || id <= 0 || id > 2147483647) error(404, 'Milestone not found');
	const milestone = await getMilestone(id);
	if (!milestone) error(404, 'Milestone not found');
	const [scopes, updates] = await Promise.all([listHillScopes(id), listHillUpdates(id)]);
	return { milestone, scopes, updates };
};
