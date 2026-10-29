import { error } from '@sveltejs/kit';
import { sql } from './db';

export async function listTodayIds(userId: number): Promise<number[]> {
	const rows = await sql<{ issueId: number }[]>`
		select t.issue_id from today_issues t
		join issues i on i.id = t.issue_id join statuses s on s.id = i.status_id
		where t.user_id = ${userId} and not s.is_closed
		order by t.position, t.issue_id
	`;
	return rows.map((r) => r.issueId);
}

export async function addToToday(userId: number, issueId: number) {
	await sql.begin(async (tx) => {
		// Serialize edits to one user's queue, including its first entry.
		await tx`select id from users where id = ${userId} for no key update`;
		const [issue] = await tx<{ isClosed: boolean }[]>`
			select s.is_closed from issues i join statuses s on s.id = i.status_id
			where i.id = ${issueId} for share of i
		`;
		if (!issue) error(404, 'Issue not found');
		if (issue.isClosed) error(400, 'Reopen this issue before adding it to Today');
		await tx`
			insert into today_issues (user_id, issue_id, position)
			select ${userId}, ${issueId}, coalesce(max(position), -1) + 1
			from today_issues where user_id = ${userId}
			on conflict (user_id, issue_id) do nothing
		`;
	});
}

export async function removeFromToday(userId: number, issueId: number) {
	await sql.begin(async (tx) => {
		await tx`select id from users where id = ${userId} for no key update`;
		await tx`delete from today_issues where user_id = ${userId} and issue_id = ${issueId}`;
	});
}

export async function reorderToday(userId: number, ids: number[]) {
	await sql.begin(async (tx) => {
		await tx`select id from users where id = ${userId} for no key update`;
		const current = await tx<{ issueId: number }[]>`
			select t.issue_id from today_issues t
			join issues i on i.id = t.issue_id join statuses s on s.id = i.status_id
			where t.user_id = ${userId} and not s.is_closed
		`;
		const members = new Set(current.map((r) => r.issueId));
		if (members.size !== ids.length || ids.some((id) => !members.has(id)))
			error(409, 'Your Today list changed. Refresh and try again.');
		if (!ids.length) return;
		await tx`
			update today_issues t set position = ordered.position::int
			from unnest(${ids}::int[]) with ordinality as ordered(issue_id, position)
			where t.user_id = ${userId} and t.issue_id = ordered.issue_id
		`;
	});
}
