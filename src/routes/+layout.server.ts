import type { LayoutServerLoad } from './$types';
import { inboxCount, listApps, listMilestones, listStatuses } from '#lib/server/repo.ts';
import { s3Enabled } from '#lib/server/s3.ts';
import { unreadNotificationCount } from '#lib/server/notifications.ts';
import { listTodayIds } from '#lib/server/today.ts';

export const load: LayoutServerLoad = async ({ locals }) => {
	// login/setup/invite pages render without any tracker data
	if (!locals.user)
		return {
			user: null,
			apps: [],
			statuses: [],
			milestones: [],
			attachmentsEnabled: false,
			unreadCount: 0,
			inboxCount: 0,
			todayIds: [] as number[]
		};
	const [apps, statuses, milestones, unreadCount, todayIds, captures] = await Promise.all([
		listApps(),
		listStatuses(),
		listMilestones(),
		unreadNotificationCount(locals.user.id),
		listTodayIds(locals.user.id),
		inboxCount()
	]);
	return {
		user: locals.user,
		apps,
		statuses,
		milestones,
		attachmentsEnabled: s3Enabled,
		unreadCount,
		inboxCount: captures,
		todayIds
	};
};
