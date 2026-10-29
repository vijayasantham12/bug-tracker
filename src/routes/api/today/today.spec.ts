import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '#lib/types.ts';

const mocks = vi.hoisted(() => ({ add: vi.fn(), remove: vi.fn(), reorder: vi.fn() }));
vi.mock('#lib/server/today.ts', () => ({
	addToToday: mocks.add,
	removeFromToday: mocks.remove,
	reorderToday: mocks.reorder
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

import { DELETE, PATCH, POST } from './+server';

const user: User = { id: 7, name: 'Solo', email: 'solo@example.test', role: 'admin' };
function event(body: unknown, signedIn = true) {
	return {
		locals: { user: signedIn ? user : null },
		request: new Request('http://localhost/api/today', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		})
	} as Parameters<typeof POST>[0];
}

beforeEach(() => vi.resetAllMocks());

describe('Today API', () => {
	it('adds and removes issues only for the signed-in user', async () => {
		expect((await POST(event({ issueId: 12, userId: 999 }))).status).toBe(200);
		expect(mocks.add).toHaveBeenCalledWith(7, 12);
		expect((await DELETE(event({ issueId: 12, userId: 999 }))).status).toBe(200);
		expect(mocks.remove).toHaveBeenCalledWith(7, 12);
	});

	it('preserves the exact requested order and scopes it to the signed-in user', async () => {
		await PATCH(event({ ids: [42, 12, 5], userId: 999 }));
		expect(mocks.reorder).toHaveBeenCalledWith(7, [42, 12, 5]);
	});

	it('accepts an empty order so an empty queue can be validated', async () => {
		await PATCH(event({ ids: [] }));
		expect(mocks.reorder).toHaveBeenCalledWith(7, []);
	});

	it('rejects malformed bodies and invalid issue IDs before modifying anything', async () => {
		for (const body of [
			null,
			[],
			{},
			{ issueId: 0 },
			{ issueId: -1 },
			{ issueId: '12' },
			{ issueId: 1.5 },
			{ issueId: 2147483648 }
		]) {
			await expect(POST(event(body))).rejects.toMatchObject({ status: 400 });
			await expect(DELETE(event(body))).rejects.toMatchObject({ status: 400 });
		}
		for (const body of [
			null,
			[],
			{},
			{ ids: null },
			{ ids: '12' },
			{ ids: [1, 1] },
			{ ids: [0] },
			{ ids: ['12'] },
			{ ids: [1.5] },
			{ ids: [2147483648] }
		]) {
			await expect(PATCH(event(body))).rejects.toMatchObject({ status: 400 });
		}
		expect(mocks.add).not.toHaveBeenCalled();
		expect(mocks.remove).not.toHaveBeenCalled();
		expect(mocks.reorder).not.toHaveBeenCalled();
	});

	it('returns 400 for invalid JSON', async () => {
		const invalid = {
			...event({}),
			request: new Request('http://localhost/api/today', { method: 'POST', body: '{' })
		};
		await expect(POST(invalid)).rejects.toMatchObject({ status: 400 });
		expect(mocks.add).not.toHaveBeenCalled();
	});

	it('requires authentication for every change', async () => {
		await expect(POST(event({ issueId: 12 }, false))).rejects.toMatchObject({ status: 401 });
		await expect(DELETE(event({ issueId: 12 }, false))).rejects.toMatchObject({ status: 401 });
		await expect(PATCH(event({ ids: [12] }, false))).rejects.toMatchObject({ status: 401 });
		expect(mocks.add).not.toHaveBeenCalled();
		expect(mocks.remove).not.toHaveBeenCalled();
		expect(mocks.reorder).not.toHaveBeenCalled();
	});

	it('keeps stale-list conflicts visible to the caller', async () => {
		const { error } = await import('@sveltejs/kit');
		mocks.reorder.mockImplementation(() =>
			error(409, 'Your Today list changed. Refresh and try again.')
		);
		await expect(PATCH(event({ ids: [12] }))).rejects.toMatchObject({ status: 409 });
	});
});
