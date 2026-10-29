import webpush, { WebPushError } from 'web-push';
import { VAPID_SUBJECT } from '$app/env/private';
import { sql } from './db';
import { recordNotifications } from './notifications';
import { NOTIFY_DEFAULTS, type NotifyPrefs, type PushDevice } from '#lib/types.ts';

export interface PushPayload {
	title: string;
	body: string;
	/** opened on click */
	url: string;
	/** a newer notification with the same tag replaces the older one */
	tag?: string;
}

// ---------- VAPID keys: generated once, kept in app_settings ----------

let keys: Promise<{ publicKey: string; privateKey: string }> | undefined;

function vapidKeys() {
	return (keys ??= (async () => {
		const generated = webpush.generateVAPIDKeys();
		// first instance to get here wins; everyone then reads the stored pair
		await sql`
			insert into app_settings (key, value)
			values ('vapid', ${JSON.stringify(generated)}) on conflict (key) do nothing
		`;
		const [row] = await sql<
			{ value: string }[]
		>`select value from app_settings where key = 'vapid'`;
		return JSON.parse(row.value) as { publicKey: string; privateKey: string };
	})());
}

export async function vapidPublicKey() {
	return (await vapidKeys()).publicKey;
}

// ---------- subscriptions ----------

export async function saveSubscription(
	userId: number,
	sub: { endpoint: string; keys: { p256dh: string; auth: string } },
	device: string | null
) {
	await sql`
		insert into push_subscriptions (user_id, endpoint, p256dh, auth, device)
		values (${userId}, ${sub.endpoint}, ${sub.keys.p256dh}, ${sub.keys.auth}, ${device})
		on conflict (endpoint) do update
			set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
				device = excluded.device
	`;
}

export async function deleteSubscription(userId: number, by: { endpoint?: string; id?: number }) {
	if (by.endpoint)
		await sql`delete from push_subscriptions where user_id = ${userId} and endpoint = ${by.endpoint}`;
	else if (by.id)
		await sql`delete from push_subscriptions where user_id = ${userId} and id = ${by.id}`;
}

export function listDevices(userId: number) {
	return sql<PushDevice[]>`
		select id, device, created_at from push_subscriptions where user_id = ${userId} order by created_at
	`;
}

// ---------- preferences ----------

export async function getPrefs(userId: number): Promise<NotifyPrefs & { timezone: string | null }> {
	const [row] = await sql<{ notify: Partial<NotifyPrefs>; timezone: string | null }[]>`
		select notify, timezone from users where id = ${userId}
	`;
	return { ...NOTIFY_DEFAULTS, ...row?.notify, timezone: row?.timezone ?? null };
}

export async function savePrefs(userId: number, prefs: Partial<NotifyPrefs>, timezone?: string) {
	const clean: Partial<NotifyPrefs> = {};
	for (const [k, v] of Object.entries(prefs) as [keyof NotifyPrefs, unknown][]) {
		if (!(k in NOTIFY_DEFAULTS)) continue;
		if (k === 'digestTime') {
			if (typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v)) clean.digestTime = v;
		} else if (typeof v === 'boolean') clean[k] = v as never;
	}
	const tz = timezone && isTimezone(timezone) ? timezone : null;
	await sql`
		update users set notify = notify || ${sql.json(clean)}, timezone = coalesce(${tz}, timezone)
		where id = ${userId}
	`;
}

export function isTimezone(tz: string) {
	try {
		new Intl.DateTimeFormat('en', { timeZone: tz });
		return true;
	} catch {
		return false;
	}
}

// ---------- sending ----------

/** Records in the inbox first, then sends to the recipient's devices. */
export async function notifyUsers(
	userIds: number[],
	pref: keyof NotifyPrefs | null,
	payload: PushPayload
) {
	const ids = await recordNotifications(userIds, pref, payload);
	if (!ids.length) return;
	const subs = await sql<{ id: number; endpoint: string; p256dh: string; auth: string }[]>`
		select s.id, s.endpoint, s.p256dh, s.auth
		from push_subscriptions s
		where s.user_id = any(${ids}::int[])
	`;
	if (!subs.length) return;
	const { publicKey, privateKey } = await vapidKeys();
	const body = JSON.stringify(payload);
	await Promise.all(
		subs.map(async (s) => {
			try {
				await webpush.sendNotification(
					{ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
					body,
					{ vapidDetails: { subject: VAPID_SUBJECT, publicKey, privateKey }, TTL: 24 * 3600 }
				);
			} catch (e) {
				// 404/410: the browser dropped this subscription (uninstalled, permission revoked)
				if (e instanceof WebPushError && (e.statusCode === 404 || e.statusCode === 410))
					await sql`delete from push_subscriptions where id = ${s.id}`;
				else console.error('push failed', s.endpoint.slice(0, 60), (e as Error).message);
			}
		})
	);
}
