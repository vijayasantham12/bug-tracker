import { error } from '@sveltejs/kit';
import { sql } from './db';
import { deleteObjects } from './s3';
import { toAppName } from '#lib/appname.ts';
import { PAGE_SIZE, type Filters } from '#lib/filters.ts';
import {
	ENVIRONMENTS,
	PRIORITIES,
	RELATION_KINDS,
	SEVERITIES,
	SIZES,
	REPEATS,
	TYPES,
	type App,
	type Attachment,
	type Issue,
	type IssueEvent,
	type IssueLink,
	type IssuePatch,
	type IssueRef,
	type Milestone,
	type NewIssue,
	type Relation,
	type RelationKind,
	type SimilarIssue,
	type Status,
	type User
} from '#lib/types.ts';

type Tx = typeof sql;

const APP_COLORS = [
	'#3b82f6',
	'#22c55e',
	'#f59e0b',
	'#ef4444',
	'#8b5cf6',
	'#ec4899',
	'#14b8a6',
	'#f97316',
	'#64748b'
];

/** Needs `i` (issues) in scope; BLOCKED_STATUS also needs `s` (its status). */
const BLOCKED_BY_OPEN = sql`exists (
	select 1 from issue_relations r join issues b on b.id = r.from_id
	join statuses bs on bs.id = b.status_id
	where r.to_id = i.id and r.kind = 'blocks' and not bs.is_closed
)`;
const BLOCKED_STATUS = sql`lower(s.name) = 'blocked'`;

const issueColumns = sql`
	i.id, i.app_id, a.name as app_name, a.color as app_color, i.type, i.title, i.description,
	i.status_id, i.priority, i.labels, i.version, i.fixed_in, i.due_date::text as due_date,
	i.milestone_id, (select m.name from milestones m where m.id = i.milestone_id) as milestone_name,
	i.parent_id, i.size, i.severity, i.environment, i.repeat, i.remind_at,
	i.created_at, i.updated_at, i.closed_at,
	(select count(*)::int from issues c where c.parent_id = i.id) as subtask_count,
	(select count(*)::int from issues c join statuses cs on cs.id = c.status_id
		where c.parent_id = i.id and cs.is_closed) as subtask_done,
	${BLOCKED_BY_OPEN} as is_blocked,
	(select count(*)::int from issue_events e where e.issue_id = i.id and e.kind = 'comment') as comment_count,
	(select count(*)::int from attachments f where f.issue_id = i.id) as attachment_count,
	(select u.name from users u where u.id = i.created_by) as created_by_name
`;

const SORT_SQL = {
	id: sql`i.id`,
	title: sql`lower(i.title)`,
	app: sql`lower(a.name)`,
	status: sql`s.position`,
	priority: sql`i.priority`,
	type: sql`i.type`,
	milestone: sql`(select lower(m.name) from milestones m where m.id = i.milestone_id)`,
	size: sql`array_position(array['xs', 's', 'm', 'l', 'xl'], i.size)`,
	updated: sql`i.updated_at`,
	created: sql`i.created_at`
};

export const MILESTONE_NAME_MAX = 40;

/** "safari crash" → "safari:* & crash:*", so a half-typed word still matches; null without words. */
export function prefixTsQuery(q: string): string | null {
	const words = q.toLowerCase().match(/[\p{L}\p{N}_]+/gu);
	return words ? words.map((w) => `${w}:*`).join(' & ') : null;
}

// ---------- issues ----------

/** One page of matching issues plus the total match count. */
export async function listIssues(f: Filters): Promise<{ issues: Issue[]; total: number }> {
	const where = [sql`true`];
	if (f.apps.length)
		where.push(sql`lower(a.name) = any(${f.apps.map((a) => a.toLowerCase())}::text[])`);
	if (f.status === 'open') where.push(sql`not s.is_closed`);
	else if (f.status === 'closed') where.push(sql`s.is_closed`);
	else if (f.status !== 'all') {
		const ids = f.status.split(',').map(Number).filter(Number.isInteger);
		where.push(sql`i.status_id = any(${ids}::int[])`);
	}
	if (f.types.length) where.push(sql`i.type = any(${f.types}::text[])`);
	if (f.priorities.length) where.push(sql`i.priority = any(${f.priorities}::int[])`);
	if (f.label) where.push(sql`${f.label} = any(i.labels)`);
	if (f.milestone === 'none') where.push(sql`i.milestone_id is null`);
	else if (f.milestone) where.push(sql`i.milestone_id = ${Number(f.milestone)}`);
	if (f.severities.length) where.push(sql`i.severity = any(${f.severities}::text[])`);
	if (f.envs.length) where.push(sql`i.environment = any(${f.envs}::text[])`);
	if (f.parent) where.push(sql`i.parent_id = ${f.parent}`);
	if (f.sizes.length) where.push(sql`i.size = any(${f.sizes}::text[])`);
	if (f.overdue) where.push(sql`i.due_date < current_date`);
	if (f.dueWeek) where.push(sql`i.due_date between current_date and current_date + 7`);
	if (f.blocked) where.push(sql`(${BLOCKED_STATUS} or ${BLOCKED_BY_OPEN})`);
	// full text over title, description and comments; the title ilike keeps substrings like
	// "checkout.ts" or "500" findable, which the english parser splits or drops
	const id = /^#?(\d+)$/.exec(f.q.trim())?.[1];
	const tsq = f.q && !id ? prefixTsQuery(f.q) : null;
	const query = tsq ? sql`to_tsquery('english', ${tsq})` : null;
	if (f.q) {
		const like = `%${f.q.replace(/[\\%_]/g, '\\$&')}%`;
		where.push(
			id
				? sql`(i.id = ${Number(id)} or i.title ilike ${like})`
				: query
					? sql`(i.search @@ ${query} or i.title ilike ${like} or exists (
							select 1 from issue_events e where e.issue_id = i.id and e.kind = 'comment'
								and to_tsvector('english'::regconfig, e.body) @@ ${query}))`
					: sql`i.title ilike ${like}`
		);
	}
	const cond = where.reduce((acc, w) => sql`${acc} and ${w}`);
	const dir = f.dir === 'asc' ? sql`asc` : sql`desc`;
	// best match first while searching with the default sort
	const order =
		query && f.sort === 'id' && f.dir === 'desc'
			? sql`ts_rank(i.search, ${query}) desc, i.id desc`
			: sql`${SORT_SQL[f.sort]} ${dir}, i.id desc`;

	const from = sql`from issues i join apps a on a.id = i.app_id join statuses s on s.id = i.status_id`;

	const [issues, [{ total }]] = await Promise.all([
		sql<Issue[]>`
			select ${issueColumns} ${from}
			where ${cond}
			order by ${order}
			limit ${f.limit ?? PAGE_SIZE} offset ${(f.page - 1) * PAGE_SIZE}
		`,
		sql<{ total: number }[]>`select count(*)::int as total ${from} where ${cond}`
	]);
	return { issues, total };
}

export async function getIssue(id: number) {
	const [issue] = await sql<Issue[]>`
		select ${issueColumns} from issues i join apps a on a.id = i.app_id where i.id = ${id}
	`;
	return issue ?? null;
}

export function listEvents(issueId: number) {
	return sql<IssueEvent[]>`
		select e.id, e.kind, e.field, e.old_value, e.new_value, e.body, e.created_at, e.user_id, u.name as user_name
		from issue_events e left join users u on u.id = e.user_id
		where e.issue_id = ${issueId} order by e.created_at, e.id
	`;
}

async function ensureApp(tx: Tx, rawName: string): Promise<number> {
	const name = toAppName(rawName);
	if (!name) throw new Error(`Invalid app name: ${rawName}`);
	const [{ n }] = await tx<{ n: number }[]>`select count(*)::int as n from apps`;
	const [row] = await tx<{ id: number }[]>`
		insert into apps (name, color) values (${name}, ${APP_COLORS[n % APP_COLORS.length]})
		on conflict ((lower(name))) do update set archived = false
		returning id
	`;
	return row.id;
}

async function ensureMilestone(tx: Tx, rawName: string): Promise<number> {
	const name = rawName.trim().slice(0, MILESTONE_NAME_MAX);
	if (!name) error(400, 'Milestone name is empty');
	const [row] = await tx<{ id: number }[]>`
		insert into milestones (name) values (${name})
		on conflict ((lower(name))) do update set name = milestones.name
		returning id
	`;
	return row.id;
}

/** Subtasks are one level deep: the parent can't be a subtask, and an issue with subtasks can't become one. */
async function checkParent(tx: Tx, id: number | null, parentId: number) {
	if (parentId === id) error(400, "An issue can't be its own parent");
	const [parent] = await tx<{ parentId: number | null }[]>`
		select parent_id from issues where id = ${parentId}
	`;
	if (!parent) error(400, `Issue #${parentId} not found`);
	if (parent.parentId) error(400, `#${parentId} is a subtask itself; subtasks can't have subtasks`);
	if (id !== null && (await tx`select 1 from issues where parent_id = ${id} limit 1`).length)
		error(400, `#${id} has subtasks, so it can't become a subtask`);
}

/**
 * Creates one issue per (item, app), plus the item's subtasks under each of them.
 * Unknown app and milestone names are created on the fly. `ids` are the top-level issues.
 */
export async function createIssues(
	items: NewIssue[],
	userId: number
): Promise<{ ids: number[]; subtaskIds: number[] }> {
	return sql.begin(async (tx) => {
		const [def] = await tx<{ id: number }[]>`
			select id from statuses order by is_default desc, position limit 1
		`;
		const appIds = new Map<string, number>();
		const ids: number[] = [];
		const subtaskIds: number[] = [];
		for (const item of items) {
			const milestoneId = item.milestone
				? await ensureMilestone(tx as unknown as Tx, item.milestone)
				: null;
			if (item.parentId) await checkParent(tx as unknown as Tx, null, item.parentId);
			for (const name of item.apps) {
				const key = name.toLowerCase();
				if (!appIds.has(key)) appIds.set(key, await ensureApp(tx as unknown as Tx, name));
				const [row] = await tx<{ id: number }[]>`
					insert into issues ${tx({
						appId: appIds.get(key)!,
						type: item.type ?? 'bug',
						title: item.title,
						description: item.description ?? '',
						statusId: def.id,
						priority: item.priority ?? 2,
						labels: item.labels ?? [],
						milestoneId,
						parentId: item.parentId ?? null,
						size: item.size && SIZES.includes(item.size) ? item.size : null,
						dueDate: item.dueDate ?? null,
						createdBy: userId
					})}
					returning id
				`;
				ids.push(row.id);
				for (const sub of item.subtasks ?? []) {
					const [child] = await tx<{ id: number }[]>`
						insert into issues ${tx({
							appId: appIds.get(key)!,
							type: sub.type ?? 'task',
							title: sub.title,
							description: sub.description ?? '',
							statusId: def.id,
							priority: sub.priority ?? 2,
							labels: [...new Set([...(item.labels ?? []), ...(sub.labels ?? [])])],
							milestoneId,
							parentId: row.id,
							size: sub.size && SIZES.includes(sub.size) ? sub.size : null,
							dueDate: sub.dueDate ?? null,
							createdBy: userId
						})}
						returning id
					`;
					subtaskIds.push(child.id);
				}
			}
		}
		return { ids, subtaskIds };
	});
}

const PATCHABLE = [
	'title',
	'description',
	'appId',
	'type',
	'statusId',
	'priority',
	'labels',
	'version',
	'fixedIn',
	'dueDate',
	'milestoneId',
	'parentId',
	'size',
	'severity',
	'environment',
	'repeat'
] as const;

/** Allowed values for enum-like fields; anything else is a 400. */
const ALLOWED: Partial<Record<(typeof PATCHABLE)[number], readonly unknown[]>> = {
	type: TYPES,
	priority: PRIORITIES.map((p) => p.value),
	size: SIZES,
	severity: SEVERITIES.map((s) => s.value),
	environment: ENVIRONMENTS.map((e) => e.value),
	repeat: REPEATS.map((r) => r.value)
};

const FIELD_NAME: Record<(typeof PATCHABLE)[number], string> = {
	title: 'title',
	description: 'description',
	appId: 'app',
	type: 'type',
	statusId: 'status',
	priority: 'priority',
	labels: 'labels',
	version: 'version',
	fixedIn: 'fixed in',
	dueDate: 'due',
	milestoneId: 'milestone',
	parentId: 'parent',
	size: 'size',
	severity: 'severity',
	environment: 'environment',
	repeat: 'repeat'
};

type Raw = Record<(typeof PATCHABLE)[number], unknown>;

async function display(
	tx: Tx,
	field: (typeof PATCHABLE)[number],
	v: unknown
): Promise<string | null> {
	if (v === null || v === undefined || v === '') return null;
	if (field === 'statusId')
		return (await tx`select name from statuses where id = ${v as number}`)[0]?.name ?? null;
	if (field === 'appId')
		return (await tx`select name from apps where id = ${v as number}`)[0]?.name ?? null;
	if (field === 'milestoneId')
		return (await tx`select name from milestones where id = ${v as number}`)[0]?.name ?? null;
	if (field === 'parentId') return `#${v}`;
	if (field === 'size') return String(v).toUpperCase();
	if (field === 'priority') return PRIORITIES[v as number]?.label ?? String(v);
	if (field === 'labels') return (v as string[]).join(', ') || null;
	if (field === 'description') return null;
	return String(v);
}

function same(a: unknown, b: unknown) {
	return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/** Field changes an update made, as raw values (ids, not names): what notifications react to. */
export type IssueChange = { field: (typeof PATCHABLE)[number]; before: unknown; after: unknown };

/** Returns the changes made (possibly none), or null if the issue doesn't exist. */
export async function updateIssue(
	id: number,
	patch: IssuePatch,
	userId: number
): Promise<IssueChange[] | null> {
	return sql.begin(async (tx_) => {
		const tx = tx_ as unknown as Tx;
		const [cur] = await tx<Raw[]>`
			select title, description, app_id, type, status_id, priority, labels, version, fixed_in,
				due_date::text as due_date, milestone_id, parent_id, size, severity, environment, repeat
			from issues where id = ${id} for update
		`;
		if (!cur) return null;

		const set: Record<string, string | number | string[] | null> = {};
		const events: Record<string, unknown>[] = [];
		const changes: IssueChange[] = [];
		for (const key of PATCHABLE) {
			if (!(key in patch)) continue;
			let next = patch[key] as unknown;
			if (typeof next === 'string' && key !== 'title' && key !== 'description')
				next = next.trim() || null;
			if (key === 'labels')
				next = [
					...new Set(((next as string[]) ?? []).map((l) => l.trim().toLowerCase()).filter(Boolean))
				];
			if (key === 'title' && !String(next).trim()) continue;
			if (same(cur[key], next)) continue;
			if (next !== null && ALLOWED[key] && !ALLOWED[key].includes(next))
				error(400, `Invalid ${FIELD_NAME[key]}: ${next}`);
			if (key === 'parentId' && next !== null) await checkParent(tx, id, next as number);
			set[key] = next as string | number | string[] | null;
			changes.push({ field: key, before: cur[key], after: next });
			events.push({
				issueId: id,
				userId,
				kind: 'change',
				field: FIELD_NAME[key],
				oldValue: await display(tx, key, cur[key]),
				newValue: await display(tx, key, next)
			});
		}
		if (!events.length) return changes;

		await tx`update issues set ${tx(set, Object.keys(set))}, updated_at = now() where id = ${id}`;
		await tx`insert into issue_events ${tx(events)}`;
		if ('statusId' in set) {
			await syncClosedAt(tx, [id]);
			await spawnRepeat(tx, id, userId);
		}
		return changes;
	});
}

/**
 * A repeating issue that was just closed hands its repeat on to a fresh copy, due one interval
 * after the old due date (or today), skipping intervals already past so missed ones don't pile up.
 */
async function spawnRepeat(tx: Tx, id: number, userId: number) {
	const [old] = await tx<{ repeat: string }[]>`
		select i.repeat from issues i join statuses s on s.id = i.status_id
		where i.id = ${id} and s.is_closed and i.repeat is not null
	`;
	if (!old) return;
	const step = REPEATS.find((r) => r.value === old.repeat)!.interval;
	const [def] = await tx<{ id: number }[]>`
		select id from statuses order by is_default desc, position limit 1
	`;
	const [next] = await tx<{ id: number }[]>`
		insert into issues (app_id, type, title, description, status_id, priority, labels, size,
			severity, environment, parent_id, repeat, due_date, created_by)
		select app_id, type, title, description, ${def.id}, priority, labels, size,
			severity, environment, parent_id, repeat,
			(select max(d)::date from generate_series(
				coalesce(due_date, current_date) + ${step}::interval,
				greatest(coalesce(due_date, current_date), current_date) + ${step}::interval,
				${step}::interval) d),
			${userId}
		from issues where id = ${id}
		returning id
	`;
	await tx`update issues set repeat = null where id = ${id}`;
	await tx`insert into issue_events ${tx([
		{
			issueId: id,
			userId,
			kind: 'change',
			field: 'repeat',
			oldValue: old.repeat,
			newValue: `next is #${next.id}`
		},
		{
			issueId: next.id,
			userId,
			kind: 'change',
			field: 'repeat',
			oldValue: null,
			newValue: `${old.repeat}, after #${id}`
		}
	])}`;
}

async function syncClosedAt(tx: Tx, ids: number[]) {
	await tx`
		update issues i
		set closed_at = case when s.is_closed then coalesce(i.closed_at, now()) else null end
		from statuses s
		where s.id = i.status_id and i.id = any(${ids}::int[])
	`;
	await tx`
		delete from today_issues t using issues i, statuses s
		where t.issue_id = i.id and i.status_id = s.id and s.is_closed
			and i.id = any(${ids}::int[])
	`;
}

export async function deleteIssues(ids: number[]) {
	const files = await sql<{ key: string }[]>`
		delete from attachments where issue_id = any(${ids}::int[]) returning key
	`;
	await sql`delete from issues where id = any(${ids}::int[])`;
	await deleteObjects(files.map((f) => f.key));
}

// ---------- attachments ----------

export function listAttachments(issueId: number) {
	return sql<Attachment[]>`
		select id, filename, mime, size, created_at from attachments
		where issue_id = ${issueId} order by created_at, id
	`;
}

export async function getAttachment(id: number) {
	const [row] = await sql<{ key: string; filename: string; mime: string }[]>`
		select key, filename, mime from attachments where id = ${id}
	`;
	return row ?? null;
}

export async function addAttachments(
	issueId: number,
	files: { filename: string; mime: string; size: number; key: string }[],
	userId: number
) {
	await sql.begin(async (tx) => {
		await tx`insert into attachments ${tx(files.map((f) => ({ issueId, ...f })))}`;
		await tx`insert into issue_events ${tx(
			files.map((f) => ({
				issueId,
				userId,
				kind: 'change',
				field: 'attachment',
				newValue: f.filename
			}))
		)}`;
		await tx`update issues set updated_at = now() where id = ${issueId}`;
	});
}

export async function deleteAttachment(issueId: number, id: number, userId: number) {
	const [row] = await sql<{ key: string; filename: string }[]>`
		delete from attachments where id = ${id} and issue_id = ${issueId} returning key, filename
	`;
	if (!row) return;
	await sql`
		insert into issue_events (issue_id, user_id, kind, field, old_value)
		values (${issueId}, ${userId}, 'change', 'attachment', ${row.filename})
	`;
	await deleteObjects([row.key]);
}

export async function addComment(issueId: number, body: string, userId: number) {
	await sql.begin(async (tx) => {
		await tx`
			insert into issue_events (issue_id, user_id, kind, body)
			values (${issueId}, ${userId}, 'comment', ${body})
		`;
		await tx`update issues set updated_at = now() where id = ${issueId}`;
	});
}

/** Authors can delete their own comments; admins can delete any. */
export async function deleteComment(issueId: number, eventId: number, user: User) {
	await sql`
		delete from issue_events
		where id = ${eventId} and issue_id = ${issueId} and kind = 'comment'
			and (${user.role === 'admin'} or user_id = ${user.id})
	`;
}

export async function listLabels(): Promise<string[]> {
	const rows = await sql<
		{ label: string }[]
	>`select distinct unnest(labels) as label from issues order by 1`;
	return rows.map((r) => r.label);
}

// ---------- reminders ----------

/** Sets (or clears, with null) the issue's "remind me"; it goes to `userId`. */
export async function setReminder(id: number, at: Date | null, userId: number) {
	await sql`
		update issues set remind_at = ${at}, remind_user_id = ${at ? userId : null} where id = ${id}
	`;
}

/** Claims every reminder that is due (clearing it, so it is sent once) and returns them. */
export function takeDueReminders() {
	return sql<{ id: number; title: string; userId: number }[]>`
		update issues i set remind_at = null, remind_user_id = null
		from (select id, remind_user_id from issues where remind_at <= now() for update skip locked) due
		where i.id = due.id
		returning i.id, i.title, due.remind_user_id as user_id
	`;
}

// ---------- subtasks, links, relations ----------

export async function getIssueRef(id: number) {
	const [row] = await sql<IssueRef[]>`
		select i.id, i.title, i.status_id, s.is_closed
		from issues i join statuses s on s.id = i.status_id where i.id = ${id}
	`;
	return row ?? null;
}

export function listSubtasks(parentId: number) {
	return sql<IssueRef[]>`
		select i.id, i.title, i.status_id, s.is_closed
		from issues i join statuses s on s.id = i.status_id
		where i.parent_id = ${parentId}
		order by s.is_closed, s.position, i.id
	`;
}

async function logChange(
	tx: Tx,
	issueId: number,
	userId: number,
	field: string,
	change: { oldValue?: string; newValue?: string }
) {
	await tx`insert into issue_events ${tx({ issueId, userId, kind: 'change', field, oldValue: null, newValue: null, ...change })}`;
	await tx`update issues set updated_at = now() where id = ${issueId}`;
}

export function listLinks(issueId: number) {
	return sql<IssueLink[]>`
		select id, url, title from issue_links where issue_id = ${issueId} order by id
	`;
}

/** Only http(s) URLs (they become hrefs); a bare "github.com/x" gets https:// in front. */
export function cleanUrl(input: string): string | null {
	const raw = input.trim();
	if (!raw) return null;
	try {
		const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`);
		return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
	} catch {
		return null;
	}
}

export async function addLink(issueId: number, url: string, title: string | null, userId: number) {
	await sql.begin(async (tx_) => {
		const tx = tx_ as unknown as Tx;
		await tx`insert into issue_links (issue_id, url, title) values (${issueId}, ${url}, ${title})`;
		await logChange(tx, issueId, userId, 'link', { newValue: title || url });
	});
}

export async function deleteLink(issueId: number, linkId: number, userId: number) {
	await sql.begin(async (tx_) => {
		const tx = tx_ as unknown as Tx;
		const [row] = await tx<{ url: string; title: string | null }[]>`
			delete from issue_links where id = ${linkId} and issue_id = ${issueId} returning url, title
		`;
		if (row) await logChange(tx, issueId, userId, 'link', { oldValue: row.title || row.url });
	});
}

const relationLabel = (kind: RelationKind) => RELATION_KINDS.find((k) => k.value === kind)!.label;
const INVERSE: Record<RelationKind, RelationKind> = {
	relates: 'relates',
	blocks: 'blocked_by',
	blocked_by: 'blocks',
	duplicates: 'duplicated_by',
	duplicated_by: 'duplicates'
};

/** Relations of an issue, phrased from its side ("blocked by #12"). */
export function listRelations(id: number) {
	return sql<Relation[]>`
		select r.id,
			case when r.kind = 'relates' or r.from_id = ${id} then r.kind
				when r.kind = 'blocks' then 'blocked_by' else 'duplicated_by' end as kind,
			o.id as other_id, o.title as other_title, s.is_closed as other_closed
		from issue_relations r
		join issues o on o.id = case when r.from_id = ${id} then r.to_id else r.from_id end
		join statuses s on s.id = o.status_id
		where r.from_id = ${id} or r.to_id = ${id}
		order by r.kind, o.id
	`;
}

/** `#id <kind> #otherId`, e.g. addRelation(5, 'blocked_by', 3) stores "3 blocks 5". Logged on both issues. */
export async function addRelation(id: number, kind: RelationKind, otherId: number, userId: number) {
	if (!INVERSE[kind]) error(400, `Unknown relation: ${kind}`);
	if (id === otherId) error(400, "An issue can't be related to itself");
	await sql.begin(async (tx_) => {
		const tx = tx_ as unknown as Tx;
		if (!(await tx`select 1 from issues where id = ${otherId}`).length)
			error(400, `Issue #${otherId} not found`);
		const [from, to, stored] =
			kind === 'blocked_by' || kind === 'duplicated_by'
				? [otherId, id, kind === 'blocked_by' ? 'blocks' : 'duplicates']
				: [id, otherId, kind];
		// 'relates' has no direction: skip if it exists either way round
		if (
			stored === 'relates' &&
			(
				await tx`select 1 from issue_relations where kind = 'relates'
					and ((from_id = ${id} and to_id = ${otherId}) or (from_id = ${otherId} and to_id = ${id}))`
			).length
		)
			return;
		const added = await tx`
			insert into issue_relations (from_id, to_id, kind) values (${from}, ${to}, ${stored})
			on conflict do nothing returning id
		`;
		if (!added.length) return;
		await logChange(tx, id, userId, 'relation', { newValue: `${relationLabel(kind)} #${otherId}` });
		await logChange(tx, otherId, userId, 'relation', {
			newValue: `${relationLabel(INVERSE[kind])} #${id}`
		});
	});
}

export async function deleteRelation(id: number, relationId: number, userId: number) {
	const rel = (await listRelations(id)).find((r) => r.id === relationId);
	if (!rel) return;
	await sql.begin(async (tx_) => {
		const tx = tx_ as unknown as Tx;
		await tx`delete from issue_relations where id = ${relationId}`;
		await logChange(tx, id, userId, 'relation', {
			oldValue: `${relationLabel(rel.kind)} #${rel.otherId}`
		});
		await logChange(tx, rel.otherId, userId, 'relation', {
			oldValue: `${relationLabel(INVERSE[rel.kind])} #${id}`
		});
	});
}

// ---------- milestones ----------

export function listMilestones() {
	return sql<Milestone[]>`
		select m.id, m.name, m.due_date::text as due_date, m.done,
			(count(i.id) filter (where not s.is_closed))::int as open_count,
			count(i.id)::int as total_count
		from milestones m
		left join issues i on i.milestone_id = m.id
		left join statuses s on s.id = i.status_id
		group by m.id
		order by m.done, m.due_date nulls last, lower(m.name)
	`;
}

export async function createMilestone(name: string, dueDate: string | null) {
	const [row] = await sql<{ id: number }[]>`
		insert into milestones (name, due_date) values (${name}, ${dueDate}) returning id
	`;
	return row.id;
}

export async function updateMilestone(
	id: number,
	patch: Partial<Pick<Milestone, 'name' | 'dueDate' | 'done'>>
) {
	const keys = (['name', 'dueDate', 'done'] as const).filter((k) => k in patch);
	if (keys.length) await sql`update milestones set ${sql(patch, keys)} where id = ${id}`;
}

/** Issues keep existing, just without a milestone. */
export async function deleteMilestone(id: number) {
	await sql`delete from milestones where id = ${id}`;
}

// ---------- apps ----------

export function listApps() {
	return sql<App[]>`
		select a.id, a.name, a.color, a.archived,
			(count(i.id) filter (where not s.is_closed))::int as open_count,
			count(i.id)::int as total_count
		from apps a
		left join issues i on i.app_id = a.id
		left join statuses s on s.id = i.status_id
		group by a.id
		order by a.archived, lower(a.name)
	`;
}

export async function createApp(name: string, color?: string) {
	const id = await sql.begin((tx) => ensureApp(tx as unknown as Tx, name));
	if (color) await sql`update apps set color = ${color} where id = ${id}`;
}

export async function updateApp(
	id: number,
	patch: Partial<Pick<App, 'name' | 'color' | 'archived'>>
) {
	if ('name' in patch) patch = { ...patch, name: toAppName(patch.name ?? '') };
	const keys = (['name', 'color', 'archived'] as const).filter((k) => k in patch);
	if (keys.length) await sql`update apps set ${sql(patch, keys)} where id = ${id}`;
}

/** Only empty apps can be deleted; archive the rest. */
export async function deleteApp(id: number): Promise<boolean> {
	const [{ n }] = await sql<
		{ n: number }[]
	>`select count(*)::int as n from issues where app_id = ${id}`;
	if (n > 0) return false;
	await sql`delete from apps where id = ${id}`;
	return true;
}

// ---------- statuses ----------

export function listStatuses() {
	return sql<
		Status[]
	>`select id, name, color, position, is_closed, is_default from statuses order by position, id`;
}

export async function createStatus(name: string, isClosed = false) {
	await sql`
		insert into statuses (name, is_closed, position)
		values (${name}, ${isClosed}, (select coalesce(max(position), 0) + 1 from statuses))
	`;
}

export async function updateStatus(id: number, patch: Partial<Omit<Status, 'id'>>) {
	await sql.begin(async (tx_) => {
		const tx = tx_ as unknown as Tx;
		const keys = (['name', 'color', 'position', 'isClosed', 'isDefault'] as const).filter(
			(k) => k in patch
		);
		if (!keys.length) return;
		if (patch.isDefault) await tx`update statuses set is_default = false`;
		await tx`update statuses set ${tx(patch, keys)} where id = ${id}`;
		if ('isClosed' in patch) {
			const ids = (await tx<{ id: number }[]>`select id from issues where status_id = ${id}`).map(
				(r) => r.id
			);
			if (ids.length) await syncClosedAt(tx, ids);
		}
	});
}

/** Moves issues in the status to the default status, then deletes it. Refuses the default status. */
export async function deleteStatus(id: number): Promise<boolean> {
	return sql.begin(async (tx_) => {
		const tx = tx_ as unknown as Tx;
		const [def] = await tx<
			{ id: number }[]
		>`select id from statuses where is_default and id <> ${id} limit 1`;
		if (!def) return false;
		const moved = await tx<{ id: number }[]>`
			update issues set status_id = ${def.id}, updated_at = now() where status_id = ${id} returning id
		`;
		if (moved.length)
			await syncClosedAt(
				tx,
				moved.map((r) => r.id)
			);
		await tx`delete from statuses where id = ${id}`;
		return true;
	});
}

/** Swaps position with the neighbour in the given direction. */
export async function moveStatus(id: number, delta: -1 | 1) {
	const all = await listStatuses();
	const i = all.findIndex((s) => s.id === id);
	const j = i + delta;
	if (i < 0 || j < 0 || j >= all.length) return;
	const order = all.map((s) => s.id);
	[order[i], order[j]] = [order[j], order[i]];
	await sql.begin(async (tx) => {
		for (const [pos, sid] of order.entries())
			await tx`update statuses set position = ${pos} where id = ${sid}`;
	});
}

// ---------- dashboard ----------

/** Open issues in the user's chosen focus order, independent of priority and due date. */
export async function listTodayIssues(userId: number): Promise<Issue[]> {
	return sql<Issue[]>`
		select ${issueColumns} from today_issues t
		join issues i on i.id = t.issue_id join apps a on a.id = i.app_id
		join statuses s on s.id = i.status_id
		where t.user_id = ${userId} and not s.is_closed
		order by t.position, t.issue_id
	`;
}

/**
 * Solo-dev dashboard. "In progress" = open, not the default status, not a status named Blocked.
 * "Up next" / "quick wins" = still in the default status and not blocked by an open issue.
 */
export async function dashboard() {
	const from = sql`from issues i join apps a on a.id = i.app_id join statuses s on s.id = i.status_id`;
	const notStarted = sql`not s.is_closed and s.is_default and not ${BLOCKED_BY_OPEN}`;

	const upNext = await sql<Issue[]>`
		select ${issueColumns} ${from} where ${notStarted}
		order by i.priority, i.due_date nulls last, i.id
		limit 5
	`;
	const shown = upNext.map((i) => i.id);

	const [inProgress, quickWins, shipped, [fires], trend, milestones, perApp] = await Promise.all([
		sql<Issue[]>`
				select ${issueColumns} ${from}
				where not s.is_closed and not s.is_default and not ${BLOCKED_STATUS}
				order by s.position, i.priority, i.updated_at desc
				limit 10
			`,
		// skips what Up next already shows
		sql<Issue[]>`
				select ${issueColumns} ${from}
				where ${notStarted} and i.size in ('xs', 's') and i.id <> all(${shown}::int[])
				order by i.priority, i.id
				limit 5
			`,
		sql<Issue[]>`
				select ${issueColumns} ${from}
				where s.is_closed and i.closed_at > now() - interval '7 days'
				order by i.closed_at desc
				limit 10
			`,
		sql<
			{
				open: number;
				prodBugs: number;
				overdue: number;
				dueWeek: number;
				blocked: number;
				stale: number;
			}[]
		>`
				select count(*)::int as open,
					(count(*) filter (where i.type = 'bug' and i.environment = 'production'
						and i.severity in ('critical', 'major')))::int as prod_bugs,
					(count(*) filter (where i.due_date < current_date))::int as overdue,
					(count(*) filter (where i.due_date between current_date and current_date + 7))::int
						as due_week,
					(count(*) filter (where ${BLOCKED_STATUS} or ${BLOCKED_BY_OPEN}))::int as blocked,
					(count(*) filter (where i.updated_at < now() - interval '30 days'))::int as stale
				${from} where not s.is_closed
			`,
		// last 8 weeks (Monday-based), oldest first; "closed" counts issues still closed today
		sql<{ week: string; created: number; closed: number }[]>`
				select w.week::date::text as week,
					(select count(*)::int from issues i
						where i.created_at >= w.week and i.created_at < w.week + interval '1 week') as created,
					(select count(*)::int from issues i
						where i.closed_at >= w.week and i.closed_at < w.week + interval '1 week') as closed
				from generate_series(date_trunc('week', now()) - interval '7 weeks', date_trunc('week', now()),
					interval '1 week') as w (week)
				order by w.week
			`,
		sql<
			{
				id: number;
				name: string;
				dueDate: string | null;
				total: number;
				done: number;
				openBugs: number;
				openFeatures: number;
				openOther: number;
			}[]
		>`
				select m.id, m.name, m.due_date::text as due_date,
					count(i.id)::int as total,
					(count(i.id) filter (where s.is_closed))::int as done,
					(count(i.id) filter (where not s.is_closed and i.type = 'bug'))::int as open_bugs,
					(count(i.id) filter (where not s.is_closed and i.type = 'feature'))::int as open_features,
					(count(i.id) filter (where not s.is_closed and i.type not in ('bug', 'feature')))::int
						as open_other
				from milestones m
				left join issues i on i.milestone_id = m.id
				left join statuses s on s.id = i.status_id
				where not m.done
				group by m.id
				order by m.due_date nulls last, lower(m.name)
			`,
		sql<{ id: number; name: string; color: string; open: number; bugs: number; urgent: number }[]>`
				select a.id, a.name, a.color,
					(count(i.id) filter (where not s.is_closed))::int as open,
					(count(i.id) filter (where not s.is_closed and i.type = 'bug'))::int as bugs,
					(count(i.id) filter (where not s.is_closed and i.priority <= 1))::int as urgent
				from apps a
				left join issues i on i.app_id = a.id
				left join statuses s on s.id = i.status_id
				where not a.archived
				group by a.id
				order by lower(a.name)
			`
	]);
	return { inProgress, upNext, quickWins, shipped, fires, trend, milestones, perApp };
}

// ---------- duplicate hints ----------

// words too common in issue titles to say anything about similarity
const STOPWORDS = new Set(
	'the and for with when not does from into this that are was has have should can cant wont dont after before on in of to is it a an add fix bug issue error page'.split(
		' '
	)
);
const titleWords = (title: string) =>
	new Set((title.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []).filter((w) => !STOPWORDS.has(w)));

/**
 * Open issues whose titles share most of the meaningful words with `title`
 * (at least 2, and at least half of the query's words). Best 3 first.
 */
export async function similarIssues(title: string): Promise<SimilarIssue[]> {
	const words = titleWords(title);
	if (words.size < 2) return [];
	const patterns = [...words].map((w) => `%${w}%`);
	const rows = await sql<SimilarIssue[]>`
		select i.id, i.title, s.name as status_name
		from issues i join statuses s on s.id = i.status_id
		where not s.is_closed and i.title ilike any(${patterns}::text[])
		order by i.updated_at desc
		limit 300
	`;
	const need = Math.max(2, Math.ceil(words.size / 2));
	return rows
		.map((r) => {
			const theirs = titleWords(r.title);
			return { r, shared: [...words].filter((w) => theirs.has(w)).length };
		})
		.filter((x) => x.shared >= need)
		.sort((a, b) => b.shared - a.shared)
		.slice(0, 3)
		.map((x) => x.r);
}

/** App of the user's most recent issue, else the first active app: the default for API capture. */
export async function lastUsedApp(userId: number): Promise<string | null> {
	const [row] = await sql<{ name: string }[]>`
		(select a.name from issues i join apps a on a.id = i.app_id
			where i.created_by = ${userId} and not a.archived order by i.created_at desc, i.id desc limit 1)
		union all
		(select name from apps where not archived order by lower(name) limit 1)
		limit 1
	`;
	return row?.name ?? null;
}
