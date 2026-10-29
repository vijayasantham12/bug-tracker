import type { PageServerLoad } from './$types';
import { listApiTokens, listInvites, listUsers } from '#lib/server/auth.ts';
import { getPrefs, listDevices, vapidPublicKey } from '#lib/server/push.ts';
import { requireUser } from '#lib/server/session.ts';

export const load: PageServerLoad = async ({ locals, url }) => {
	const user = requireUser(locals);
	const [tokens, notify, devices, pushKey] = await Promise.all([
		listApiTokens(user.id),
		getPrefs(user.id),
		listDevices(user.id),
		vapidPublicKey()
	]);
	// what the iOS Shortcut should call; behind a proxy this is the public origin
	const captureUrl = `${url.origin}/api/capture`;
	const mine = { tokens, captureUrl, notify, devices, pushKey };
	if (user.role !== 'admin') return { users: [], invites: [], ...mine };
	const [users, invites] = await Promise.all([listUsers(), listInvites()]);
	return { users, invites, ...mine };
};
