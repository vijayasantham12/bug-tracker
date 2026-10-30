import type { PageServerLoad } from './$types';
import { listTrash, TRASH_DAYS, TRASH_PAGE_SIZE } from '#lib/server/trash.ts';

export const load: PageServerLoad = async ({ url }) => {
	const raw = Number(url.searchParams.get('page'));
	const page = Number.isSafeInteger(raw) && raw > 0 ? Math.min(raw, 1_000_000) : 1;
	return { ...(await listTrash(page)), page, pageSize: TRASH_PAGE_SIZE, retentionDays: TRASH_DAYS };
};
