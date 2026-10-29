import { sql } from './db';
import { NOTIFY_DEFAULTS, type InboxNotification, type NotifyPrefs } from '#lib/types.ts';

/** Save once per user, even without a push subscription. Category preferences apply to both channels. */
export async function recordNotifications(
	userIds: number[],
	kind: keyof NotifyPrefs | null,
	payload: { title: string; body: string; url: string }
) {
	if (!userIds.length) return [];
	const rows = await sql<{ userId: number }[]>`
		insert into notifications (user_id, kind, title, body, url)
		select u.id, ${kind}, ${payload.title}, ${payload.body}, ${payload.url}
		from users u where u.id = any(${[...new Set(userIds)]}::int[])
			${kind ? sql`and coalesce((u.notify ->> ${kind})::boolean, ${NOTIFY_DEFAULTS[kind] as boolean})` : sql``}
		returning user_id
	`;
	return rows.map((r) => r.userId);
}

export async function unreadNotificationCount(userId: number) {
	const [row] = await sql<{ count: number }[]>`
		select count(*)::int as count from notifications
		where user_id = ${userId} and read_at is null
			and created_at >= now() - interval '30 days'
	`;
	return row.count;
}

export async function listNotifications(userId: number, before: number | null = null) {
	const rows = await sql<InboxNotification[]>`
		select id, title, body, url, created_at, read_at from notifications
		where user_id = ${userId} and created_at >= now() - interval '30 days'
			${before === null ? sql`` : sql`and id < ${before}`}
		order by id desc limit 31
	`;
	const items = rows.slice(0, 30);
	return { items, nextCursor: rows.length > 30 ? items.at(-1)!.id : null };
}

export function markNotificationsRead(userId: number, id: number | null, through: number | null) {
	return sql`
		update notifications set read_at = now()
		where user_id = ${userId} and read_at is null
			and created_at >= now() - interval '30 days'
			${id !== null ? sql`and id = ${id}` : sql`and id <= ${through}`}
	`;
}

export function pruneNotifications() {
	return sql`delete from notifications where created_at < now() - interval '30 days'`;
}
