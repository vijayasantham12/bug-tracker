import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import {
	getIssue,
	getIssueRef,
	listAttachments,
	listEvents,
	listLabels,
	listLinks,
	listRelations,
	listSubtasks
} from '#lib/server/repo.ts';

export const load: PageServerLoad = async ({ params }) => {
	const id = Number(params.id);
	if (!Number.isInteger(id)) error(404, 'Not found');
	const [issue, events, labels, attachments, subtasks, links, relations] = await Promise.all([
		getIssue(id),
		listEvents(id),
		listLabels(),
		listAttachments(id),
		listSubtasks(id),
		listLinks(id),
		listRelations(id)
	]);
	if (!issue) error(404, `Issue #${id} not found`);
	const parent = issue.parentId ? await getIssueRef(issue.parentId) : null;
	return { issue, events, labels, attachments, subtasks, links, relations, parent };
};
