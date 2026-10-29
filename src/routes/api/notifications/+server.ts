import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '#lib/server/session.ts';
import {
	listNotifications,
	markNotificationsRead,
	unreadNotificationCount
} from '#lib/server/notifications.ts';

const validId = (value: unknown): value is number =>
	typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= 2_147_483_647;

export const GET: RequestHandler = async ({ locals, url }) => {
	const user = requireUser(locals);
	const raw = url.searchParams.get('before');
	const before = raw === null ? null : Number(raw);
	if (before !== null && !validId(before)) error(400, 'Invalid notification cursor');
	const unreadCount = await unreadNotificationCount(user.id);
	const result =
		url.searchParams.get('count') === '1' ? {} : await listNotifications(user.id, before);
	return json({ ...result, unreadCount }, { headers: { 'cache-control': 'private, no-store' } });
};

/** { id } marks one entry; { through } marks all entries up to the newest one seen. */
export const PATCH: RequestHandler = async ({ locals, request }) => {
	const user = requireUser(locals);
	const body = await request.json().catch(() => null);
	if (!body || typeof body !== 'object' || Array.isArray(body)) error(400, 'Invalid request');
	const { id, through } = body;
	if ((id === undefined) === (through === undefined)) error(400, 'Provide id or through');
	if (!validId(id ?? through)) error(400, 'Invalid notification id');
	await markNotificationsRead(user.id, id ?? null, through ?? null);
	return json({ unreadCount: await unreadNotificationCount(user.id) });
};
