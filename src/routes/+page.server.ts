import type { PageServerLoad } from './$types';
import { parseFilters } from '#lib/filters.ts';
import { listIssues, listLabels } from '#lib/server/repo.ts';
import { listViews } from '#lib/server/views.ts';
import { requireUser } from '#lib/server/session.ts';

export const load: PageServerLoad = async ({ url, locals }) => {
	const filters = parseFilters(url.searchParams);
	const [{ issues, total }, labels, views] = await Promise.all([
		listIssues(filters),
		listLabels(),
		listViews(requireUser(locals).id)
	]);
	return { issues, total, labels, views };
};
