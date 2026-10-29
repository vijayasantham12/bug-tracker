import { sql } from './db';
import type { SavedView } from '#lib/types.ts';

export const VIEW_NAME_MAX = 40;

export function listViews(userId: number) {
	return sql<SavedView[]>`
		select id, name, query from saved_views where user_id = ${userId} order by lower(name), id
	`;
}

/** Saving under an existing name replaces that view's filters. */
export async function saveView(userId: number, name: string, query: string) {
	await sql`
		insert into saved_views (user_id, name, query) values (${userId}, ${name}, ${query})
		on conflict (user_id, lower(name)) do update set query = excluded.query
	`;
}

export async function deleteView(userId: number, id: number) {
	await sql`delete from saved_views where id = ${id} and user_id = ${userId}`;
}
