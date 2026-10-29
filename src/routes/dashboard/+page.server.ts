import type { PageServerLoad } from './$types';
import { dashboard, listTodayIssues } from '#lib/server/repo.ts';
import { requireUser } from '#lib/server/session.ts';

export const load: PageServerLoad = async ({ locals }) => {
	const user = requireUser(locals);
	const [stats, today] = await Promise.all([dashboard(), listTodayIssues(user.id)]);
	return { ...stats, today };
};
