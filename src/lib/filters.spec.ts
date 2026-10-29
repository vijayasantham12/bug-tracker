import { describe, it, expect } from 'vitest';
import { filtersToQuery, parseFilters } from './filters';

const parse = (q: string) => parseFilters(new URLSearchParams(q));

describe('page filter', () => {
	it('defaults to 1 and ignores junk', () => {
		for (const q of ['', 'page=0', 'page=-3', 'page=abc', 'page=1.5', 'page=1e9'])
			expect(parse(q).page).toBe(1);
		expect(parse('page=4').page).toBe(4);
	});

	it('only appears in the query past page 1', () => {
		expect(filtersToQuery(parse('page=1'))).toBe('');
		expect(filtersToQuery(parse('app=shop&page=3'))).toBe('?app=shop&page=3');
	});
});

describe('dashboard filters', () => {
	it('parses size, due this week and blocked', () => {
		const f = parse('size=xs,s,huge&due=week&blocked=1');
		expect(f.sizes).toEqual(['xs', 's']);
		expect(f.dueWeek).toBe(true);
		expect(f.overdue).toBe(false);
		expect(f.blocked).toBe(true);
	});

	it('round-trips through the query string', () => {
		for (const q of ['size=xs,s', 'due=week', 'due=overdue', 'blocked=1']) {
			const f = parse(q);
			expect(parse(filtersToQuery(f).slice(1))).toEqual(f);
		}
	});
});
