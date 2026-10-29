import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { User } from '#lib/types.ts';

const mocks = vi.hoisted(() => ({ restore: vi.fn() }));
vi.mock('#lib/server/trash.ts', () => ({ restoreIssues: mocks.restore }));
vi.mock('#lib/server/session.ts', async () => {
	const { error } = await import('@sveltejs/kit');
	return {
		requireUser: (locals: { user: User | null }) => {
			if (!locals.user) error(401, 'Not signed in');
			return locals.user;
		}
	};
});
import { POST } from './+server';

const user: User = { id: 7, name: 'Solo', email: 'solo@example.test', role: 'admin' };
function event(body: unknown, signedIn = true) {
	return {
		locals: { user: signedIn ? user : null },
		request: new Request('http://localhost/api/trash', {
			method: 'POST',
			body: JSON.stringify(body)
		})
	} as Parameters<typeof POST>[0];
}
beforeEach(() => {
	vi.resetAllMocks();
	mocks.restore.mockResolvedValue([12, 13]);
});

describe('Trash restore API', () => {
	it('restores as the signed-in actor and returns all restored IDs', async () => {
		const response = await POST(event({ ids: [12], userId: 999 }));
		expect(mocks.restore).toHaveBeenCalledWith([12], 7);
		expect(await response.json()).toEqual({ ids: [12, 13] });
	});
	it('rejects invalid input before modifying issues', async () => {
		for (const body of [
			null,
			[],
			{},
			{ ids: [] },
			{ ids: [1, 1] },
			{ ids: ['12'] },
			{ ids: [0] },
			{ ids: [-1] },
			{ ids: [1.5] },
			{ ids: [2147483648] },
			{ ids: Array.from({ length: 501 }, (_, i) => i + 1) }
		])
			await expect(POST(event(body))).rejects.toMatchObject({ status: 400 });
		expect(mocks.restore).not.toHaveBeenCalled();
	});
	it('requires authentication and rejects malformed JSON', async () => {
		await expect(POST(event({ ids: [12] }, false))).rejects.toMatchObject({ status: 401 });
		const invalid = {
			...event({}),
			request: new Request('http://localhost/api/trash', { method: 'POST', body: '{' })
		};
		await expect(POST(invalid)).rejects.toMatchObject({ status: 400 });
		expect(mocks.restore).not.toHaveBeenCalled();
	});
	it('keeps expired-issue and parent conflicts visible to the caller', async () => {
		const { error } = await import('@sveltejs/kit');
		for (const status of [404, 409]) {
			mocks.restore.mockImplementation(() => error(status, 'Cannot restore'));
			await expect(POST(event({ ids: [12] }))).rejects.toMatchObject({ status });
		}
	});
});
