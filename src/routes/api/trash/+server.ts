import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '#lib/server/session.ts';
import { readIssueIds } from '#lib/server/issue-input.ts';
import { restoreIssues } from '#lib/server/trash.ts';

export const POST: RequestHandler = async ({ request, locals }) => {
	const user = requireUser(locals);
	const ids = await restoreIssues(await readIssueIds(request), user.id);
	return json({ ids });
};
