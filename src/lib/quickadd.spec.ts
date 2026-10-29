import { describe, it, expect } from 'vitest';
import { parseCapture, parseDue, parseLine, parseQuickAdd } from './quickadd';

describe('parseLine', () => {
	it('parses plain titles', () => {
		expect(parseLine('login button broken')).toEqual({
			title: 'login button broken',
			description: '',
			apps: [],
			type: undefined,
			priority: undefined,
			labels: []
		});
	});

	it('parses all tokens', () => {
		expect(
			parseLine('bug: checkout crash @shop @admin !high +Safari +ios -- only on iOS 18')
		).toEqual({
			title: 'checkout crash',
			description: 'only on iOS 18',
			apps: ['shop', 'admin'],
			type: 'bug',
			priority: 1,
			labels: ['safari', 'ios']
		});
	});

	it('parses milestone and size', () => {
		const r = parseLine('feat: csv export ^v1.3 ~M @shop');
		expect(r?.title).toBe('csv export');
		expect(r?.milestone).toBe('v1.3');
		expect(r?.size).toBe('m');
		expect(parseLine('fix ~huge thing')?.title).toBe('fix ~huge thing');
	});

	it('accepts numeric priority and short type prefixes', () => {
		const r = parseLine('f: dark mode !0');
		expect(r?.type).toBe('feature');
		expect(r?.priority).toBe(0);
		expect(r?.title).toBe('dark mode');
	});

	it('leaves unknown prefixes and inline @ in the title', () => {
		const r = parseLine('note: email me@x.com fails !wat');
		expect(r?.type).toBeUndefined();
		expect(r?.title).toBe('note: email me@x.com fails !wat');
	});

	it('lowercases app names and drops trailing punctuation', () => {
		expect(parseLine('crash on save @Admin-Panel @Shop.')?.apps).toEqual(['admin-panel', 'shop']);
	});

	it('rejects lines with only tokens', () => {
		expect(parseLine('@shop !high')).toBeNull();
		expect(parseLine('   ')).toBeNull();
	});
});

describe('parseQuickAdd', () => {
	it('creates one issue per line', () => {
		expect(parseQuickAdd('a @x\n\n b @y \n')).toHaveLength(2);
	});
});

// Thursday 29 Oct 2026
const today = new Date(2026, 9, 29);

describe('parseDue', () => {
	it('understands relative and named dates', () => {
		expect(parseDue('today', today)).toBe('2026-10-29');
		expect(parseDue('tomorrow', today)).toBe('2026-10-30');
		expect(parseDue('3d', today)).toBe('2026-11-01');
		expect(parseDue('2w', today)).toBe('2026-11-12');
		expect(parseDue('fri', today)).toBe('2026-10-30');
		expect(parseDue('thursday', today)).toBe('2026-11-05'); // next one, never today
		expect(parseDue('mon', today)).toBe('2026-11-02');
		expect(parseDue('nov5', today)).toBe('2026-11-05');
		expect(parseDue('5nov', today)).toBe('2026-11-05');
		expect(parseDue('jan3', today)).toBe('2027-01-03'); // already past this year
		expect(parseDue('2026-12-24', today)).toBe('2026-12-24');
	});

	it('rejects things that are not dates', () => {
		for (const t of ['soon', 'fr', 'feb30', '2026-02-30', 'nov', 'x5', 'm'])
			expect(parseDue(t, today)).toBeNull();
	});
});

describe('quick add extras', () => {
	it('takes a due date token and leaves unknown * words in the title', () => {
		const r = parseLine('ship invoices *fri @shop', today);
		expect(r?.dueDate).toBe('2026-10-30');
		expect(r?.title).toBe('ship invoices');
		expect(parseLine('fix the *weird* thing', today)?.title).toBe('fix the *weird* thing');
	});

	it('strips list bullets and checkboxes', () => {
		expect(
			parseQuickAdd('- one\n* two\n3. three\n- [ ] four\n- [x] five').map((i) => i.title)
		).toEqual(['one', 'two', 'three', 'four', 'five']);
	});
});

describe('parseCapture', () => {
	it('turns indented bullets into subtasks and indented text into descriptions', () => {
		const items = parseCapture(
			[
				'- checkout crash on safari !high',
				'  only with apple pay',
				'- csv export @crm *fri',
				'  - add date filter',
				'    John wants last 30 days',
				'  - zip download ~s',
				'',
				'feat: dark mode ^v1.4'
			].join('\n'),
			today
		);
		expect(items).toHaveLength(3);
		expect(items[0]).toMatchObject({
			title: 'checkout crash on safari',
			priority: 1,
			description: 'only with apple pay',
			subtasks: []
		});
		expect(items[1]).toMatchObject({ title: 'csv export', apps: ['crm'], dueDate: '2026-10-30' });
		expect(items[1].subtasks).toEqual([
			expect.objectContaining({ title: 'add date filter', description: 'John wants last 30 days' }),
			expect.objectContaining({ title: 'zip download', size: 's' })
		]);
		expect(items[2]).toMatchObject({ title: 'dark mode', type: 'feature', milestone: 'v1.4' });
	});

	it('treats indented lines before any issue as issues, so nothing typed is lost', () => {
		expect(parseCapture('  - first\n  note')).toMatchObject([
			{ title: 'first', description: 'note' }
		]);
	});
});
