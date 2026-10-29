import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { deleteUser, setRole } from '#lib/server/auth.ts';
import { requireAdmin } from '#lib/server/session.ts';

// admins can't demote or remove themselves, so there is always at least one admin

export const PATCH: RequestHandler = async ({ params, request, locals }) => {
	const admin = requireAdmin(locals);
	const id = Number(params.id);
	if (id === admin.id) error(400, "You can't change your own role");
	const { role } = (await request.json()) as { role: string };
	await setRole(id, role === 'admin' ? 'admin' : 'member');
	return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	const admin = requireAdmin(locals);
	const id = Number(params.id);
	if (id === admin.id) error(400, "You can't remove yourself");
	await deleteUser(id);
	return json({ ok: true });
};
