import type { PageServerLoad } from './$types';
import { listApiTokens, listInvites, listUsers } from '#lib/server/auth.ts';
import { getPrefs, listDevices, vapidPublicKey } from '#lib/server/push.ts';
import { requireUser } from '#lib/server/session.ts';
import { backupStatus } from '#lib/server/backup.ts';

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
	const mcpUrl = `${url.origin}/api/mcp`;
	const mine = { tokens, captureUrl, mcpUrl, notify, devices, pushKey };
	if (user.role !== 'admin') return { users: [], invites: [], backup: null, ...mine };
	const [users, invites, backup] = await Promise.all([listUsers(), listInvites(), backupStatus()]);
	return { users, invites, backup, ...mine };
};
