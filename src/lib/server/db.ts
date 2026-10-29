import postgres from 'postgres';
import { DATABASE_URL } from '$app/env/private';
import schema from './schema.sql?raw';

export const sql = postgres(DATABASE_URL, {
	transform: postgres.camel,
	onnotice: () => {}
});

let ready: Promise<unknown> | undefined;

/** Applies the idempotent schema once per process. */
export function migrate() {
	return (ready ??= sql.unsafe(schema).simple());
}
