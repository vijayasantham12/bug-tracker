import { error } from '@sveltejs/kit';

export const validIssueId = (id: unknown): id is number =>
	typeof id === 'number' && Number.isInteger(id) && id > 0 && id <= 2147483647;

export async function readIssueIds(request: Request): Promise<number[]> {
	const body = await request.json().catch(() => error(400, 'Invalid JSON'));
	const ids = body?.ids;
	if (
		!Array.isArray(ids) ||
		!ids.length ||
		ids.length > 500 ||
		!ids.every(validIssueId) ||
		new Set(ids).size !== ids.length
	)
		error(400, 'Expected 1–500 unique issue IDs');
	return ids;
}
