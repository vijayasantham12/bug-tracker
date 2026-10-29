import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { deleteSubscription, isTimezone, saveSubscription, savePrefs } from '#lib/server/push.ts';
import { requireUser } from '#lib/server/session.ts';

interface Body {
	subscription: { endpoint: string; keys: { p256dh: string; auth: string } };
	device?: string;
	timezone?: string;
}

/** Turns notifications on for this browser: { subscription: PushSubscription.toJSON(), device, timezone } */
export const POST: RequestHandler = async ({ request, locals }) => {
	const user = requireUser(locals);
	const { subscription: sub, device, timezone } = (await request.json()) as Body;
	if (!sub?.endpoint?.startsWith('https://') || !sub.keys?.p256dh || !sub.keys?.auth)
		error(400, 'Invalid push subscription');
	await saveSubscription(user.id, sub, device?.slice(0, 80) || null);
	if (timezone && isTimezone(timezone)) await savePrefs(user.id, {}, timezone);
	return json({ ok: true });
};

/** { endpoint } for this browser, or { id } for a device listed in Settings */
export const DELETE: RequestHandler = async ({ request, locals }) => {
	const { endpoint, id } = (await request.json()) as { endpoint?: string; id?: number };
	await deleteSubscription(requireUser(locals).id, { endpoint, id });
	return json({ ok: true });
};
