import { describe, expect, it } from 'vitest';
import { isShipped, statusKind } from './status';

const s = (name: string, isClosed = false, isDefault = false) => ({ name, isClosed, isDefault });

describe('statusKind', () => {
	it('maps the default statuses', () => {
		expect(statusKind(s('Open', false, true))).toBe('open');
		expect(statusKind(s('In Progress'))).toBe('progress');
		expect(statusKind(s('Blocked'))).toBe('blocked');
		expect(statusKind(s('Testing'))).toBe('review');
		expect(statusKind(s('Done', true))).toBe('done');
		expect(statusKind(s("Won't Fix", true))).toBe('skipped');
	});

	it('handles custom names and falls back to open', () => {
		expect(statusKind(s('Backlog', false, true))).toBe('draft');
		expect(statusKind(s('Code review'))).toBe('review');
		expect(statusKind(s('Duplicate', true))).toBe('skipped');
		expect(statusKind(s('Shipped', true))).toBe('done');
		expect(statusKind(s('Next up'))).toBe('open');
	});

	it('counts only completed closes as shipped', () => {
		expect(isShipped(s('Done', true))).toBe(true);
		expect(isShipped(s('Wontfix', true))).toBe(false);
		expect(isShipped(s('In Progress'))).toBe(false);
		expect(isShipped(undefined)).toBe(false);
	});
});
