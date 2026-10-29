import { error } from '@sveltejs/kit';
import { sql } from './db';
import type { HillScope, HillUpdate, Milestone } from '#lib/types.ts';
import type { HillInput } from './hill-input';

export async function getMilestone(id: number) {
	const [milestone] = await sql<Milestone[]>`
		select m.id, m.name, m.due_date::text as due_date, m.done, m.hill_revision,
			count(i.id)::int as total_count,
			(count(i.id) filter (where not s.is_closed))::int as open_count
		from milestones m left join issues i on i.milestone_id = m.id and i.deleted_at is null
		left join statuses s on s.id = i.status_id
		where m.id = ${id} group by m.id
	`;
	return milestone ?? null;
}

export function listHillScopes(milestoneId: number) {
	return sql<HillScope[]>`
		select id, name, color, position from milestone_hill_scopes
		where milestone_id = ${milestoneId} order by sort_order, id
	`;
}

/** The latest 50 snapshots, including labels/colors as they were when saved. */
export function listHillUpdates(milestoneId: number) {
	return sql<HillUpdate[]>`
		select h.id, h.note, h.scopes, h.created_at, u.name as user_name
		from milestone_hill_updates h left join users u on u.id = h.user_id
		where h.milestone_id = ${milestoneId} order by h.id desc limit 50
	`;
}

export async function saveHillUpdate(milestoneId: number, input: HillInput, userId: number) {
	await sql.begin(async (tx) => {
		const [milestone] = await tx<{ hillRevision: number }[]>`
			select hill_revision from milestones where id = ${milestoneId} for update
		`;
		if (!milestone) error(404, 'Milestone not found');
		if (milestone.hillRevision !== input.revision)
			error(
				409,
				'This chart changed in another tab. Reload to see the latest update before saving.'
			);
		const existing = await tx<{ id: number }[]>`
			select id from milestone_hill_scopes where milestone_id = ${milestoneId}
		`;
		const allowed = new Set(existing.map((s) => s.id));
		if (input.scopes.some((s) => s.id !== null && !allowed.has(s.id)))
			error(400, 'A piece of work does not belong to this milestone');
		const snapshot: HillScope[] = [];
		for (const [order, scope] of input.scopes.entries()) {
			let id = scope.id;
			if (id === null) {
				const [created] = await tx<{ id: number }[]>`
					insert into milestone_hill_scopes (milestone_id, name, color, position, sort_order)
					values (${milestoneId}, ${scope.name}, ${scope.color}, ${scope.position}, ${order}) returning id
				`;
				id = created.id;
			} else {
				await tx`
					update milestone_hill_scopes set name = ${scope.name}, color = ${scope.color},
						position = ${scope.position}, sort_order = ${order}
					where id = ${id} and milestone_id = ${milestoneId}
				`;
			}
			snapshot.push({ id, name: scope.name, color: scope.color, position: scope.position });
		}
		await tx`delete from milestone_hill_scopes
			where milestone_id = ${milestoneId} and id <> all(${snapshot.map((s) => s.id)}::int[])`;
		await tx`insert into milestone_hill_updates (milestone_id, user_id, note, scopes)
			values (${milestoneId}, ${userId}, ${input.note}, ${tx.json(snapshot.map((scope) => ({ ...scope })))})`;
		await tx`update milestones set hill_revision = hill_revision + 1 where id = ${milestoneId}`;
	});
}
