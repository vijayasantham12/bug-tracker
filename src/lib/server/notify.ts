import { sql } from './db';
import { notifyUsers, type PushPayload } from './push';
import { takeDueReminders, type IssueChange } from './repo';
import { NOTIFY_DEFAULTS, type NotifyPrefs } from '#lib/types.ts';
import { pruneNotifications } from './notifications';

/**
 * What triggers a push notification. Callers fire these after the write succeeded and don't
 * await them: a slow or failing push service must never fail the request.
 */

const short = (text: string, max = 90) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
const log = (what: string) => (e: unknown) => console.error(`notify ${what}:`, e);

interface IssueFacts {
	id: number;
	title: string;
	type: string;
	severity: string | null;
	environment: string | null;
	createdBy: number | null;
	statusName: string;
	isClosed: boolean;
}

const isProdBug = (i: Pick<IssueFacts, 'type' | 'severity' | 'environment'>) =>
	i.type === 'bug' &&
	i.environment === 'production' &&
	(i.severity === 'critical' || i.severity === 'major');

function getFacts(ids: number[]) {
	return sql<IssueFacts[]>`
		select i.id, i.title, i.type, i.severity, i.environment, i.created_by,
			s.name as status_name, s.is_closed
		from issues i join statuses s on s.id = i.status_id
		where i.id = any(${ids}::int[])
	`;
}

async function everyoneBut(userId: number) {
	return (await sql<{ id: number }[]>`select id from users where id <> ${userId}`).map((r) => r.id);
}

const prodBugPayload = (i: IssueFacts): PushPayload => ({
	title: `🔥 ${i.severity === 'critical' ? 'Critical' : 'Major'} production bug #${i.id}`,
	body: short(i.title),
	url: `/issues/${i.id}`,
	tag: `prod-${i.id}`
});

export function afterIssuesCreated(ids: number[], actorId: number) {
	void (async () => {
		if (!ids.length) return;
		const others = await everyoneBut(actorId);
		for (const issue of (await getFacts(ids)).filter(isProdBug))
			await notifyUsers(others, 'prodBugs', prodBugPayload(issue));
	})().catch(log('created'));
}

export function afterIssueChanged(id: number, changes: IssueChange[], actorId: number) {
	if (!changes.length) return;
	void (async () => {
		const [issue] = await getFacts([id]);
		if (!issue) return;
		const changed = new Map(changes.map((c) => [c.field, c]));

		if (changed.has('statusId') && issue.createdBy && issue.createdBy !== actorId)
			await notifyUsers([issue.createdBy], 'status', {
				title: `#${id} → ${issue.statusName}`,
				body: short(issue.title),
				url: `/issues/${id}`,
				tag: `status-${id}`
			});

		// escalated into a critical/major production bug (not just edited while already one)
		const before = { ...issue };
		for (const f of ['type', 'severity', 'environment'] as const)
			if (changed.has(f)) before[f] = changed.get(f)!.before as never;
		if (isProdBug(issue) && !isProdBug(before))
			await notifyUsers(await everyoneBut(actorId), 'prodBugs', prodBugPayload(issue));

		if (changed.has('statusId') && issue.isClosed) await notifyUnblocked(issue);
	})().catch(log('changed'));
}

/** Issues whose last open blocker was `closed`: everyone hears about it, including whoever closed it. */
async function notifyUnblocked(closed: IssueFacts) {
	const freed = await sql<{ id: number; title: string }[]>`
		select x.id, x.title
		from issue_relations r
		join issues x on x.id = r.to_id
		join statuses xs on xs.id = x.status_id
		where r.from_id = ${closed.id} and r.kind = 'blocks' and not xs.is_closed
			and not exists (
				select 1 from issue_relations r2
				join issues b on b.id = r2.from_id join statuses bs on bs.id = b.status_id
				where r2.to_id = x.id and r2.kind = 'blocks' and not bs.is_closed
			)
	`;
	if (!freed.length) return;
	const users = (await sql<{ id: number }[]>`select id from users`).map((r) => r.id);
	for (const x of freed)
		await notifyUsers(users, 'unblocked', {
			title: `✅ #${x.id} is unblocked`,
			body: short(`${x.title} — #${closed.id} was closed`),
			url: `/issues/${x.id}`,
			tag: `unblocked-${x.id}`
		});
}

/** Creator and everyone who commented before, except the author of this comment. */
export function afterComment(issueId: number, body: string, actor: { id: number; name: string }) {
	void (async () => {
		const rows = await sql<{ id: number }[]>`
			select created_by as id from issues where id = ${issueId} and created_by is not null
			union
			select user_id from issue_events where issue_id = ${issueId} and kind = 'comment' and user_id is not null
		`;
		const to = rows.map((r) => r.id).filter((id) => id !== actor.id);
		if (!to.length) return;
		await notifyUsers(to, 'comments', {
			title: `💬 ${actor.name} on #${issueId}`,
			body: short(body, 140),
			url: `/issues/${issueId}`,
			tag: `comment-${issueId}`
		});
	})().catch(log('comment'));
}

// ---------- scheduler: reminders and the daily digest, checked every minute ----------

let timer: ReturnType<typeof setInterval> | undefined;
let lastCleanup = 0;

export function startScheduler() {
	if (timer) return;
	const tick = () => {
		// Retention must still run when a push service or another notification job fails.
		if (Date.now() - lastCleanup >= 3_600_000)
			pruneNotifications()
				.then(() => {
					lastCleanup = Date.now();
				})
				.catch(log('cleanup'));
		sendReminders()
			.then(() => sendDigests())
			.catch(log('scheduler'));
	};
	timer = setInterval(tick, 60_000);
	timer.unref();
	setTimeout(tick, 5_000).unref();
}

export function stopScheduler() {
	clearInterval(timer);
	timer = undefined;
}

export async function sendReminders() {
	for (const r of await takeDueReminders())
		if (r.userId)
			await notifyUsers([r.userId], 'reminders', {
				title: `⏰ Reminder · #${r.id}`,
				body: short(r.title),
				url: `/issues/${r.id}`,
				tag: `remind-${r.id}`
			});
}

/** Local date and HH:MM in a timezone. */
export function localNow(tz: string, now = new Date()) {
	const parts = Object.fromEntries(
		new Intl.DateTimeFormat('en-CA', {
			timeZone: tz,
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit',
			hourCycle: 'h23'
		})
			.formatToParts(now)
			.map((p) => [p.type, p.value])
	);
	return {
		date: `${parts.year}-${parts.month}-${parts.day}`,
		minutes: Number(parts.hour) * 60 + Number(parts.minute)
	};
}

// a digest that's more than 3 h late (server was down, or notifications were just turned on
// in the evening) waits for the next day instead of arriving at a strange hour
const DIGEST_WINDOW_MIN = 180;

export async function sendDigests(now = new Date()) {
	const users = await sql<{ id: number; notify: Partial<NotifyPrefs>; timezone: string | null }[]>`
		select u.id, u.notify, u.timezone from users u
	`;
	for (const u of users) {
		const prefs = { ...NOTIFY_DEFAULTS, ...u.notify };
		if (!prefs.digest) continue;
		const { date, minutes } = localNow(u.timezone ?? 'UTC', now);
		const [h, m] = prefs.digestTime.split(':').map(Number);
		const late = minutes - (h * 60 + m);
		if (late < 0 || late > DIGEST_WINDOW_MIN) continue;
		// claim today's digest first, so two ticks (or two servers) never both send it
		const claimed = await sql`
			update users set last_digest_on = ${date}
			where id = ${u.id} and (last_digest_on is null or last_digest_on < ${date})
			returning id
		`;
		if (!claimed.length) continue;
		const payload = await digestFor(date);
		if (payload) await notifyUsers([u.id], 'digest', payload);
	}
}

/** Summary for a local date, or null when there's nothing worth a notification. */
export async function digestFor(date: string): Promise<PushPayload | null> {
	const [c] = await sql<{ dueToday: number; overdue: number; prodBugs: number }[]>`
		select
			(count(*) filter (where i.due_date = ${date}::date))::int as due_today,
			(count(*) filter (where i.due_date < ${date}::date))::int as overdue,
			(count(*) filter (where i.type = 'bug' and i.environment = 'production'
				and i.severity in ('critical', 'major')))::int as prod_bugs
		from issues i join statuses s on s.id = i.status_id
		where not s.is_closed
	`;
	const milestones = await sql<{ name: string; dueDate: string; open: number }[]>`
		select m.name, m.due_date::text as due_date, count(i.id)::int as open
		from milestones m
		join issues i on i.milestone_id = m.id
		join statuses s on s.id = i.status_id and not s.is_closed
		where not m.done and m.due_date between ${date}::date and ${date}::date + 1
		group by m.id
		order by m.due_date
	`;
	const parts = [
		c.dueToday && `${c.dueToday} due today`,
		c.overdue && `${c.overdue} overdue`,
		c.prodBugs && `${c.prodBugs} production bug${c.prodBugs === 1 ? '' : 's'} open`,
		...milestones.map(
			(m) => `${m.name} due ${m.dueDate === date ? 'today' : 'tomorrow'} (${m.open} open)`
		)
	].filter(Boolean) as string[];
	if (!parts.length) return null;
	return { title: '☀️ Today', body: parts.join(' · '), url: '/dashboard', tag: 'digest' };
}
