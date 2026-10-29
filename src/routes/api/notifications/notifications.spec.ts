import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '#lib/types.ts';

const mocks = vi.hoisted(() => ({ list: vi.fn(), mark: vi.fn(), count: vi.fn() }));
vi.mock('#lib/server/notifications.ts', () => ({
	listNotifications: mocks.list,
	markNotificationsRead: mocks.mark,
	unreadNotificationCount: mocks.count
}));
vi.mock('#lib/server/session.ts', async () => {
	const { error } = await import('@sveltejs/kit');
	return {
		requireUser: (locals: { user: User | null }) => {
			if (!locals.user) error(401, 'Not signed in');
			return locals.user;
		}
	};
});

import { GET, PATCH } from './+server';

const user: User = { id: 7, name: 'Solo', email: 'solo@example.test', role: 'admin' };
function event(query = '', body?: unknown, signedIn = true) {
	const url = new URL(`http://localhost/api/notifications${query}`);
	return {
		locals: { user: signedIn ? user : null },
		url,
		request: new Request(
			url,
			body === undefined
				? {}
				: {
						method: 'PATCH',
						headers: { 'content-type': 'application/json' },
						body: JSON.stringify(body)
					}
		)
	} as Parameters<typeof GET>[0];
}

beforeEach(() => {
	vi.resetAllMocks();
	mocks.list.mockResolvedValue({ items: [{ id: 12 }], nextCursor: null });
	mocks.count.mockResolvedValue(3);
	mocks.mark.mockResolvedValue([]);
});

describe('notification inbox API', () => {
	it('uses the signed-in user for history and unread counts, and prevents caching', async () => {
		const response = await GET(event('?before=20&userId=999'));
		expect(mocks.list).toHaveBeenCalledWith(7, 20);
		expect(mocks.count).toHaveBeenCalledWith(7);
		expect(response.headers.get('cache-control')).toBe('private, no-store');
		expect(await response.json()).toEqual({
			items: [{ id: 12 }],
			nextCursor: null,
			unreadCount: 3
		});
	});

	it('polls unread counts without loading notification bodies', async () => {
		const response = await GET(event('?count=1'));
		expect(await response.json()).toEqual({ unreadCount: 3 });
		expect(mocks.list).not.toHaveBeenCalled();
	});

	it('marks an individual notification only for the current user', async () => {
		const response = await PATCH(event('', { id: 12, userId: 999 }));
		expect(mocks.mark).toHaveBeenCalledWith(7, 12, null);
		expect(await response.json()).toEqual({ unreadCount: 3 });
	});

	it('bounds mark-all to the newest entry seen so new arrivals remain unread', async () => {
		await PATCH(event('', { through: 20 }));
		expect(mocks.mark).toHaveBeenCalledWith(7, null, 20);
	});

	it('rejects invalid cursors and read requests before accessing data', async () => {
		for (const cursor of ['0', '-1', 'abc', '1.2', '2147483648', '']) {
			await expect(GET(event(`?before=${cursor}`))).rejects.toMatchObject({ status: 400 });
		}
		for (const body of [
			null,
			[],
			{},
			{ id: 0 },
			{ id: '12' },
			{ through: -1 },
			{ id: 1, through: 2 },
			{ id: null },
			{ through: 2147483648 }
		]) {
			await expect(PATCH(event('', body))).rejects.toMatchObject({ status: 400 });
		}
		expect(mocks.list).not.toHaveBeenCalled();
		expect(mocks.mark).not.toHaveBeenCalled();
	});

	it('requires authentication to read or modify the inbox', async () => {
		await expect(GET(event('', undefined, false))).rejects.toMatchObject({ status: 401 });
		await expect(PATCH(event('', { id: 12 }, false))).rejects.toMatchObject({ status: 401 });
		expect(mocks.count).not.toHaveBeenCalled();
		expect(mocks.mark).not.toHaveBeenCalled();
	});
});
