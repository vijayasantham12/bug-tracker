import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createIssues, deleteIssues, updateIssue } from '#lib/server/repo.ts';
import { requireUser } from '#lib/server/session.ts';
import { cleanNewIssues } from '#lib/server/validate.ts';
import { afterIssueChanged, afterIssuesCreated } from '#lib/server/notify.ts';
import type { IssuePatch, NewIssue } from '#lib/types.ts';

/** Create: { items: NewIssue[] } → { ids, subtaskIds } */
export const POST: RequestHandler = async ({ request, locals }) => {
	const { items } = (await request.json()) as { items: NewIssue[] };
	const clean = cleanNewIssues(items);
	if (!clean.length) error(400, 'Nothing to add (each issue needs a title)');
	const user = requireUser(locals);
	const created = await createIssues(clean, user.id);
	afterIssuesCreated([...created.ids, ...created.subtaskIds], user.id);
	return json(created);
};

/** Bulk update: { ids: number[], patch: IssuePatch } */
export const PATCH: RequestHandler = async ({ request, locals }) => {
	const { ids, patch } = (await request.json()) as { ids: number[]; patch: IssuePatch };
	const user = requireUser(locals);
	for (const id of ids) {
		const changes = await updateIssue(id, patch, user.id);
		if (changes) afterIssueChanged(id, changes, user.id);
	}
	return json({ ok: true });
};

/** Bulk delete: { ids: number[] } */
export const DELETE: RequestHandler = async ({ request }) => {
	const { ids } = (await request.json()) as { ids: number[] };
	await deleteIssues(ids);
	return json({ ok: true });
};
