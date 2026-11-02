import type { PageServerLoad } from './$types';
import { DONE_MAX_WEEKS, listDone } from '#lib/server/repo.ts';
import { requireUser } from '#lib/server/session.ts';

export const load: PageServerLoad = async ({ locals, url }) => {
	const user = requireUser(locals);
	const raw = Number(url.searchParams.get('weeks'));
	const weeks = Number.isSafeInteger(raw) && raw > 0 ? Math.min(raw, DONE_MAX_WEEKS) : 4;
	const app = url.searchParams.get('app')?.trim() || null;
	return { ...(await listDone(user.id, weeks, app)), weeks, app, maxWeeks: DONE_MAX_WEEKS };
};
