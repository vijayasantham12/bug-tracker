import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createInvite } from '#lib/server/auth.ts';
import { requireAdmin } from '#lib/server/session.ts';
import type { Role } from '#lib/types.ts';

/** { email?: string, role?: 'admin' | 'member' } → { url } */
export const POST: RequestHandler = async ({ request, locals, url }) => {
	const admin = requireAdmin(locals);
	const { email, role } = (await request.json()) as { email?: string; role?: Role };
	const cleanEmail = email?.trim() || null;
	if (cleanEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) error(400, 'Invalid email');
	const token = await createInvite(admin.id, role === 'admin' ? 'admin' : 'member', cleanEmail);
	return json({ url: `${url.origin}/invite/${token}` });
};
