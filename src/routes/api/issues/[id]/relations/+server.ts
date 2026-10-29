import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { addRelation, deleteRelation } from '#lib/server/repo.ts';
import { requireUser } from '#lib/server/session.ts';
import type { RelationKind } from '#lib/types.ts';

/** { kind, otherId }: this issue <kind> #otherId */
export const POST: RequestHandler = async ({ params, request, locals }) => {
	const { kind, otherId } = (await request.json()) as { kind: RelationKind; otherId: number };
	await addRelation(Number(params.id), kind, Number(otherId), requireUser(locals).id);
	return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ params, request, locals }) => {
	const { relationId } = (await request.json()) as { relationId: number };
	await deleteRelation(Number(params.id), relationId, requireUser(locals).id);
	return json({ ok: true });
};
