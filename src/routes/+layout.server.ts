import type { LayoutServerLoad } from './$types';
import { listApps, listMilestones, listStatuses } from '#lib/server/repo.ts';
import { s3Enabled } from '#lib/server/s3.ts';
import { unreadNotificationCount } from '#lib/server/notifications.ts';

export const load: LayoutServerLoad = async ({ locals }) => {
	// login/setup/invite pages render without any tracker data
	if (!locals.user)
		return {
			user: null,
			apps: [],
			statuses: [],
			milestones: [],
			attachmentsEnabled: false,
			unreadCount: 0
		};
	const [apps, statuses, milestones, unreadCount] = await Promise.all([
		listApps(),
		listStatuses(),
		listMilestones(),
		unreadNotificationCount(locals.user.id)
	]);
	return {
		user: locals.user,
		apps,
		statuses,
		milestones,
		attachmentsEnabled: s3Enabled,
		unreadCount
	};
};
