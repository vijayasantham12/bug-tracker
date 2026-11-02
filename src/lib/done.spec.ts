import { describe, expect, it } from 'vitest';
import { dayLabel, groupDone, mondayOf, weekLabel, weekMarkdown, type DoneItem } from './done';

const item = (id: number, closedDay: string, extra: Partial<DoneItem> = {}): DoneItem => ({
	id,
	title: `Issue ${id}`,
	type: 'bug',
	appName: 'shop',
	fixedIn: null,
	statusId: 5,
	closedDay,
	...extra
});

describe('Done log', () => {
	it('finds the Monday of a week, including Sundays and across months', () => {
		expect(mondayOf('2026-11-01')).toBe('2026-10-26'); // Sunday
		expect(mondayOf('2026-10-26')).toBe('2026-10-26');
		expect(mondayOf('2026-03-01')).toBe('2026-02-23');
	});

	it('labels recent days and weeks relative to today', () => {
		const today = '2026-11-04'; // Wednesday
		expect(dayLabel('2026-11-04', today)).toBe('Today');
		expect(dayLabel('2026-11-03', today)).toBe('Yesterday');
		expect(dayLabel('2026-11-01', today)).toBe('Sun, Nov 1');
		expect(weekLabel('2026-11-02', today)).toBe('This week');
		expect(weekLabel('2026-10-26', today)).toBe('Last week');
		expect(weekLabel('2026-10-12', today)).toBe('Week of Oct 12');
		expect(weekLabel('2025-12-29', today)).toBe('Week of Dec 29, 2025');
	});

	it('groups newest-first issues into weeks and days', () => {
		const weeks = groupDone(
			[item(4, '2026-11-03'), item(3, '2026-11-03'), item(2, '2026-11-01'), item(1, '2026-10-20')],
			'2026-11-04'
		);
		expect(weeks.map((w) => [w.label, w.count])).toEqual([
			['This week', 2],
			['Last week', 1],
			['Week of Oct 19', 1]
		]);
		expect(weeks[0].days).toEqual([
			{ day: '2026-11-03', issues: [item(4, '2026-11-03'), item(3, '2026-11-03')] }
		]);
	});

	it('exports shipped work as Markdown sections, tagging apps only when mixed', () => {
		const [week] = groupDone(
			[
				item(3, '2026-11-03', { type: 'feature', title: 'Dark mode', fixedIn: '1.2' }),
				item(2, '2026-11-03', { title: 'Crash on save', appName: 'api' }),
				item(1, '2026-11-02', { title: 'Not a bug', statusId: 6 })
			],
			'2026-11-04'
		);
		expect(weekMarkdown(week, (i) => i.statusId === 5)).toBe(
			[
				'## This week (Nov 2)',
				'',
				'### Features',
				'- **shop**: Dark mode #3 (1.2)',
				'',
				'### Fixes',
				'- **api**: Crash on save #2'
			].join('\n')
		);
		expect(weekMarkdown(week, (i) => i.id === 3)).toBe(
			'## This week (Nov 2)\n\n### Features\n- Dark mode #3 (1.2)'
		);
	});
});
