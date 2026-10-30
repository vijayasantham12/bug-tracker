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

describe('Inbox filter', () => {
	it('keeps Inbox separate from app filters', () => {
		const f = parse('inbox=1&app=shop&status=all');
		expect(f.inbox).toBe(true);
		expect(f.apps).toEqual([]);
		expect(filtersToQuery(f)).toBe('?inbox=1&status=all');
		expect(parse('app=shop').inbox).toBe(false);
	});
});

describe('date range filters', () => {
	it('round-trips each date field with other filters and pagination', () => {
		for (const field of ['created', 'updated', 'due', 'closed']) {
			const f = parse(`inbox=1&date=${field}&from=2026-10-01&to=2026-10-29&status=all&page=2`);
			expect(f.dateField).toBe(field);
			expect(f.dateFrom).toBe('2026-10-01');
			expect(f.dateTo).toBe('2026-10-29');
			expect(parse(filtersToQuery(f))).toEqual(f);
		}
	});

	it('supports one-sided and same-day ranges', () => {
		for (const query of ['from=2026-10-29', 'to=2026-10-29', 'from=2026-10-29&to=2026-10-29']) {
			const f = parse(query);
			expect(parse(filtersToQuery(f))).toEqual(f);
		}
	});

	it('ignores invalid dates and invalid fields', () => {
		for (const invalid of [
			'2026-02-29',
			'2026-04-31',
			'2026-13-01',
			'2026-00-01',
			'0000-01-01',
			'yesterday',
			'2026-1-01'
		]) {
			const f = parse(`from=${invalid}&to=${invalid}&date=title`);
			expect(f.dateFrom).toBe('');
			expect(f.dateTo).toBe('');
			expect(f.dateField).toBe('created');
		}
		expect(parse('from=2028-02-29').dateFrom).toBe('2028-02-29');
	});

	it('normalizes reversed bounds and preserves the field before dates are entered', () => {
		const f = parse('from=2026-11-01&to=2026-10-01');
		expect(f.dateFrom).toBe('2026-10-01');
		expect(f.dateTo).toBe('2026-11-01');
		expect(filtersToQuery(parse('date=due'))).toBe('?date=due');
	});
});
