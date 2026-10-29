import { sql } from '#lib/server/db.ts';

/** Liveness + DB check for container healthchecks and load balancers. */
export async function GET() {
	try {
		await sql`select 1`;
		return new Response('ok');
	} catch {
		return new Response('db unavailable', { status: 503 });
	}
}
