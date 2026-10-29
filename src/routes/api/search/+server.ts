import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '#lib/server/session.ts';
import { getIssue, listIssues, listStatuses } from '#lib/server/repo.ts';
import { parseFilters } from '#lib/filters.ts';
import { validIssueId } from '#lib/server/issue-input.ts';
import type { SearchIssue } from '#lib/types.ts';

/** Search every app and status, excluding Trash. An empty query shows recently updated issues. */
export const GET: RequestHandler = async ({ locals, url }) => {
	requireUser(locals);
	const q = (url.searchParams.get('q') ?? '').trim().slice(0, 200);
	const filters = parseFilters(new URLSearchParams());
	filters.q = q;
	filters.status = 'all';
	filters.limit = 8;
	filters.sort = q ? 'id' : 'updated';
	const exactId = /^#?\d+$/.test(q);
	const [result, statuses] = await Promise.all([
		exactId
			? (async () => {
					const id = Number(q.replace(/^#/, ''));
					const issue = validIssueId(id) ? await getIssue(id) : null;
					return { issues: issue ? [issue] : [], total: issue ? 1 : 0 };
				})()
			: listIssues(filters),
		listStatuses()
	]);
	const statusById = new Map(statuses.map((s) => [s.id, s]));
	const issues: SearchIssue[] = result.issues.map((i) => ({
		id: i.id,
		title: i.title,
		appName: i.appName,
		appColor: i.appColor,
		statusName: statusById.get(i.statusId)?.name ?? 'Unknown',
		isClosed: statusById.get(i.statusId)?.isClosed ?? false,
		nextAction: i.nextAction.slice(0, 200)
	}));
	return json(
		{ issues, total: result.total },
		{ headers: { 'cache-control': 'private, no-store' } }
	);
};
