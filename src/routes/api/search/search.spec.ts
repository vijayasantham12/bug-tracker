import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '#lib/types.ts';

const mocks = vi.hoisted(() => ({ list: vi.fn(), get: vi.fn(), statuses: vi.fn() }));
vi.mock('#lib/server/repo.ts', () => ({
	listIssues: mocks.list,
	getIssue: mocks.get,
	listStatuses: mocks.statuses
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
import { GET } from './+server';
const user: User = { id: 7, name: 'Solo', email: 'solo@example.test', role: 'admin' };
const issue = {
	id: 12,
	title: 'Checkout',
	appName: 'shop',
	appColor: '#123456',
	statusId: 2,
	nextAction: 'Inspect cookies',
	description: 'Full report'
};
function event(query = '', signedIn = true) {
	return {
		locals: { user: signedIn ? user : null },
		url: new URL(`http://localhost/api/search${query}`)
	} as Parameters<typeof GET>[0];
}
beforeEach(() => {
	vi.resetAllMocks();
	mocks.list.mockResolvedValue({ issues: [issue], total: 20 });
	mocks.get.mockResolvedValue(issue);
	mocks.statuses.mockResolvedValue([{ id: 2, name: 'Done', isClosed: true }]);
});
describe('command palette search API', () => {
	it('requires authentication before reading tracker data', async () => {
		await expect(GET(event('', false))).rejects.toMatchObject({ status: 401 });
		expect(mocks.list).not.toHaveBeenCalled();
		expect(mocks.statuses).not.toHaveBeenCalled();
	});
	it('returns compact recent results across apps and statuses without caching private data', async () => {
		const response = await GET(event('?status=open&app=other&limit=999'));
		expect(mocks.list).toHaveBeenCalledWith(
			expect.objectContaining({ status: 'all', apps: [], limit: 8, page: 1, sort: 'updated' })
		);
		expect(response.headers.get('cache-control')).toBe('private, no-store');
		expect(await response.json()).toEqual({
			total: 20,
			issues: [
				{
					id: 12,
					title: 'Checkout',
					appName: 'shop',
					appColor: '#123456',
					statusName: 'Done',
					isClosed: true,
					nextAction: 'Inspect cookies'
				}
			]
		});
	});
	it('bounds queries and resume snippets and uses the ranked search order', async () => {
		mocks.list.mockResolvedValue({
			issues: [{ ...issue, nextAction: 'x'.repeat(1000) }],
			total: 1
		});
		const response = await GET(event(`?q=${'x'.repeat(300)}`));
		expect(mocks.list).toHaveBeenCalledWith(
			expect.objectContaining({ q: 'x'.repeat(200), sort: 'id', limit: 8 })
		);
		expect((await response.json()).issues[0].nextAction).toHaveLength(200);
	});
	it('jumps directly to a numbered issue and handles missing or trashed issues', async () => {
		await GET(event('?q=%2312'));
		expect(mocks.get).toHaveBeenCalledWith(12);
		expect(mocks.list).not.toHaveBeenCalled();
		mocks.get.mockResolvedValue(null);
		expect(await (await GET(event('?q=12'))).json()).toEqual({ issues: [], total: 0 });
	});
	it('rejects out-of-range numeric searches without sending invalid IDs to Postgres', async () => {
		for (const q of ['0', '2147483648', '9'.repeat(200)])
			expect(await (await GET(event(`?q=${q}`))).json()).toEqual({ issues: [], total: 0 });
		expect(mocks.get).not.toHaveBeenCalled();
		expect(mocks.list).not.toHaveBeenCalled();
	});
});
