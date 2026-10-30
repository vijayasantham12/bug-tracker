import { error } from '@sveltejs/kit';
import { sql } from './db';
import { deleteObject, s3Enabled } from './s3';
import type { TrashedIssue } from '#lib/types.ts';

export const TRASH_DAYS = 30;
export const TRASH_PAGE_SIZE = 50;
const recoverable = sql`i.deleted_at > now() - ${TRASH_DAYS} * interval '1 day'`;

export async function listTrash(page = 1) {
	const [issues, [count]] = await Promise.all([
		sql<TrashedIssue[]>`
			select i.id, i.title, coalesce(a.name, 'Inbox') as app_name,
				i.description, i.stopped, i.next_action, i.deleted_at,
				i.deleted_at + ${TRASH_DAYS} * interval '1 day' as expires_at,
				i.parent_id, i.deleted_with_parent,
				(select p.id from issues p where p.id = i.parent_id and p.deleted_at > now() - ${TRASH_DAYS} * interval '1 day') as trashed_parent_id
			from issues i left join apps a on a.id = i.app_id
			where ${recoverable}
			order by i.deleted_at desc, i.id
			limit ${TRASH_PAGE_SIZE} offset ${(page - 1) * TRASH_PAGE_SIZE}
		`,
		sql<{ total: number }[]>`select count(*)::int as total from issues i where ${recoverable}`
	]);
	return { issues, total: count.total };
}

/** Keep all context in place; repeat requests never extend the recovery window. */
export async function trashIssues(ids: number[], userId: number) {
	return sql.begin(async (tx) => {
		// Serialize delete, restore and retention across processes.
		await tx`select pg_advisory_xact_lock(hashtext('bug-tracker:trash'))`;
		const roots = await tx<{ id: number }[]>`
			select id from issues where id = any(${ids}::int[]) and deleted_at is null order by id for update
		`;
		if (!roots.length) return [];
		const rootIds = roots.map((r) => r.id);
		const moved = await tx<{ id: number }[]>`
			update issues set deleted_at = now(), updated_at = now(),
				deleted_with_parent = case when parent_id = any(${rootIds}::int[]) then parent_id else null end
			where deleted_at is null and (id = any(${rootIds}::int[]) or parent_id = any(${rootIds}::int[]))
			returning id
		`;
		const movedIds = moved.map((r) => r.id);
		await tx`delete from today_issues where issue_id = any(${movedIds}::int[])`;
		await tx`insert into issue_events ${tx(
			movedIds.map((issueId) => ({
				issueId,
				userId,
				kind: 'change',
				field: 'trash',
				oldValue: null,
				newValue: 'Moved to Trash'
			}))
		)}`;
		return movedIds;
	});
}

/** A parent brings back only the subtasks that were trashed along with it. */
export async function restoreIssues(ids: number[], userId: number) {
	return sql.begin(async (tx) => {
		await tx`select pg_advisory_xact_lock(hashtext('bug-tracker:trash'))`;
		const requested = await tx<{ id: number }[]>`
			select i.id from issues i where i.id = any(${ids}::int[]) and ${recoverable} order by i.id for update
		`;
		if (requested.length !== ids.length)
			error(404, 'An issue is no longer in Trash or its recovery period has expired');
		const rows = await tx<{ id: number; parentId: number | null }[]>`
			select i.id, i.parent_id from issues i
			where ${recoverable} and (i.id = any(${ids}::int[]) or i.deleted_with_parent = any(${ids}::int[]))
			order by i.id for update
		`;
		const restoring = rows.map((r) => r.id);
		const parents = rows.flatMap((r) => (r.parentId === null ? [] : [r.parentId]));
		const [blocked] = await tx<{ id: number }[]>`
			select id from issues where id = any(${parents}::int[]) and deleted_at > now() - ${TRASH_DAYS} * interval '1 day'
				and id <> all(${restoring}::int[]) limit 1
		`;
		if (blocked) error(409, `Restore parent #${blocked.id} first`);
		// A separately deleted child can still be recovered after its parent's window expires.
		await tx`update issues c set parent_id = null where c.id = any(${restoring}::int[])
			and exists (select 1 from issues p where p.id = c.parent_id
				and p.deleted_at <= now() - ${TRASH_DAYS} * interval '1 day')`;
		// Old reminders should not fire unexpectedly as soon as an issue is restored.
		await tx`update issues set deleted_at = null, deleted_with_parent = null, updated_at = now(),
			remind_user_id = case when remind_at <= now() then null else remind_user_id end,
			remind_at = case when remind_at <= now() then null else remind_at end
			where id = any(${restoring}::int[])`;
		await tx`insert into issue_events ${tx(
			restoring.map((issueId) => ({
				issueId,
				userId,
				kind: 'change',
				field: 'trash',
				oldValue: 'In Trash',
				newValue: 'Restored'
			}))
		)}`;
		return restoring;
	});
}

/** Run hourly. Queue file cleanup atomically with expiry so failed S3 deletes can be retried. */
export async function pruneTrash() {
	await sql.begin(async (tx) => {
		await tx`select pg_advisory_xact_lock(hashtext('bug-tracker:trash'))`;
		const expired = await tx<{ id: number }[]>`
			select id from issues where deleted_at <= now() - ${TRASH_DAYS} * interval '1 day'
			order by deleted_at, id limit 500 for update
		`;
		if (!expired.length) return;
		const ids = expired.map((r) => r.id);
		await tx`insert into trash_object_cleanup (key)
			select key from attachments where issue_id = any(${ids}::int[]) on conflict do nothing`;
		// A subtask deleted separately may outlive its parent in Trash.
		await tx`update issues set parent_id = null, deleted_with_parent = null
			where parent_id = any(${ids}::int[])`;
		await tx`delete from issues where id = any(${ids}::int[])`;
	});
	if (!s3Enabled) return;
	const pending = await sql<
		{ key: string }[]
	>`select key from trash_object_cleanup order by key limit 100`;
	await Promise.all(
		pending.map(async ({ key }) => {
			await deleteObject(key);
			await sql`delete from trash_object_cleanup where key = ${key}`;
		})
	);
}
