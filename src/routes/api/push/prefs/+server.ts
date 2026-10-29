import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { savePrefs } from '#lib/server/push.ts';
import { requireUser } from '#lib/server/session.ts';
import type { NotifyPrefs } from '#lib/types.ts';

export const PATCH: RequestHandler = async ({ request, locals }) => {
	const { prefs, timezone } = (await request.json()) as {
		prefs?: Partial<NotifyPrefs>;
		timezone?: string;
	};
	await savePrefs(requireUser(locals).id, prefs ?? {}, timezone);
	return json({ ok: true });
};
