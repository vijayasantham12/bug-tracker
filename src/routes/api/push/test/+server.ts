import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getPrefs, notifyUsers } from '#lib/server/push.ts';
import { digestFor, localNow } from '#lib/server/notify.ts';
import { requireUser } from '#lib/server/session.ts';

/** { kind: 'test' | 'digest' }: sends to all of your devices right away */
export const POST: RequestHandler = async ({ request, locals }) => {
	const user = requireUser(locals);
	const { kind } = (await request.json().catch(() => ({}))) as { kind?: string };
	if (kind === 'digest') {
		const { date: today } = localNow((await getPrefs(user.id)).timezone ?? 'UTC');
		const payload = (await digestFor(today)) ?? {
			title: '☀️ Today',
			body: 'Nothing due, overdue or on fire. (A real digest is skipped on days like this.)',
			url: '/dashboard',
			tag: 'digest'
		};
		await notifyUsers([user.id], null, payload);
	} else
		await notifyUsers([user.id], null, {
			title: '🐞 Notifications work',
			body: `This device will get your reminders and alerts, ${user.name}.`,
			url: '/settings',
			tag: 'test'
		});
	return json({ ok: true });
};
