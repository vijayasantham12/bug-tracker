import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getIssue, setReminder, updateIssue } from '#lib/server/repo.ts';
import { trashIssues } from '#lib/server/trash.ts';
import { validIssueId } from '#lib/server/issue-input.ts';
import { afterIssueChanged } from '#lib/server/notify.ts';
import { requireUser } from '#lib/server/session.ts';
import type { IssuePatch } from '#lib/types.ts';

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	const { remindAt, ...patch } = (await request.json()) as IssuePatch;
	const id = Number(params.id);
	const user = requireUser(locals);
	if (remindAt !== undefined) {
		const at = remindAt ? new Date(remindAt) : null;
		if (at && Number.isNaN(at.getTime())) error(400, 'Invalid reminder time');
		if (!(await getIssue(id))) error(404, 'Issue not found');
		await setReminder(id, at, user.id);
	}
	const changes = await updateIssue(id, patch, user.id);
	if (!changes) error(404, 'Issue not found');
	afterIssueChanged(id, changes, user.id);
	return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	const user = requireUser(locals);
	const id = Number(params.id);
	if (!validIssueId(id)) error(400, 'Invalid issue ID');
	await trashIssues([id], user.id);
	return json({ ok: true });
};
