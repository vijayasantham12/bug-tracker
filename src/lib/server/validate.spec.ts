import { describe, expect, it, vi } from 'vitest';

vi.mock('./auth', () => ({ MIN_PASSWORD: 8 }));

import { cleanNewIssues } from './validate';

describe('Inbox captures', () => {
	it('accepts a title without apps and defaults to a task', () => {
		const [item] = cleanNewIssues([{ title: '  Research launch ideas  ' }]);
		expect(item.title).toBe('Research launch ideas');
		expect(item.apps).toEqual([]);
		expect(item.type).toBe('task');
	});

	it('preserves explicit types and subtasks without requiring an app', () => {
		const [item] = cleanNewIssues([
			{ title: 'Launch', apps: [], type: 'feature', subtasks: [{ title: 'Write copy' }] }
		]);
		expect(item.type).toBe('feature');
		expect(item.apps).toEqual([]);
		expect(item.subtasks?.[0]).toMatchObject({ title: 'Write copy', type: 'task' });
	});

	it('keeps multi-app captures and rejects empty titles', () => {
		const items = cleanNewIssues([
			{ title: 'Fix login', apps: ['shop', 'admin', 'shop'] },
			{ title: ' ', apps: [] },
			null
		]);
		expect(items).toHaveLength(1);
		expect(items[0].apps).toEqual(['shop', 'admin']);
		expect(items[0].type).toBe('bug');
	});
});
