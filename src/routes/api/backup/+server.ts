import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { runBackup } from '#lib/server/backup.ts';
import { requireAdmin } from '#lib/server/session.ts';

/** "Back up now" in Settings. */
export const POST: RequestHandler = async ({ locals }) => {
	requireAdmin(locals);
	try {
		return json(await runBackup());
	} catch (e) {
		error(500, (e as Error).message);
	}
};
