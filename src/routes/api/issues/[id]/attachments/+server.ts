import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { deleteAttachment, getIssue } from '#lib/server/repo.ts';
import { requireUser } from '#lib/server/session.ts';
import { storeAttachments } from '#lib/server/attachments.ts';

/** multipart/form-data with one or more `file` fields */
export const POST: RequestHandler = async ({ params, request, locals }) => {
	const issueId = Number(params.id);
	if (!(await getIssue(issueId))) error(404, 'Issue not found');
	const files = (await request.formData())
		.getAll('file')
		.filter((f): f is File => f instanceof File);
	if (!files.length) error(400, 'No files');
	await storeAttachments(
		issueId,
		await Promise.all(
			files.map(async (f) => ({ name: f.name, type: f.type, data: await f.arrayBuffer() }))
		),
		requireUser(locals).id
	);
	return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ params, request, locals }) => {
	const { attachmentId } = (await request.json()) as { attachmentId: number };
	await deleteAttachment(Number(params.id), attachmentId, requireUser(locals).id);
	return json({ ok: true });
};
