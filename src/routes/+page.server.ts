import type { PageServerLoad } from './$types';
import { parseFilters } from '#lib/filters.ts';
import { listIssues, listLabels } from '#lib/server/repo.ts';

export const load: PageServerLoad = async ({ url }) => {
	const filters = parseFilters(url.searchParams);
	const [{ issues, total }, labels] = await Promise.all([listIssues(filters), listLabels()]);
	return { issues, total, labels };
};
