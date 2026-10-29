import { describe, expect, it } from 'vitest';
import { readHillInput } from './hill-input';

const scope = { id: 12, name: 'Checkout', color: '#2563eb', position: 25 };
const input = { revision: 0, note: '', scopes: [scope] };

describe('Hill Chart update validation', () => {
	it('accepts existing and newly added work and normalizes names, colors and notes', () => {
		const result = readHillInput({
			...input,
			note: '  Payment flow is clear  ',
			scopes: [scope, { ...scope, id: null, name: '  Launch  ', color: '#DB2777', position: 50 }]
		});
		expect(result.note).toBe('Payment flow is clear');
		expect(result.scopes[1]).toEqual({ id: null, name: 'Launch', color: '#db2777', position: 50 });
	});

	it('allows the full range and removing all dots without losing the update note', () => {
		for (const position of [0, 50, 100])
			expect(readHillInput({ ...input, scopes: [{ ...scope, position }] }).scopes[0].position).toBe(
				position
			);
		expect(
			readHillInput({ ...input, note: 'Reshaping this milestone', scopes: [] }).scopes
		).toEqual([]);
	});

	it('rejects invalid and fractional positions', () => {
		for (const position of [-1, 101, 2.5, null, '25', Number.NaN])
			expect(() => readHillInput({ ...input, scopes: [{ ...scope, position }] })).toThrow();
	});

	it('rejects duplicate or invalid scope IDs', () => {
		expect(() => readHillInput({ ...input, scopes: [scope, scope] })).toThrow();
		for (const id of [-1, 0, 1.5, '12', 2147483648])
			expect(() => readHillInput({ ...input, scopes: [{ ...scope, id }] })).toThrow();
	});

	it('bounds chart size and user-controlled labels, colors and notes', () => {
		expect(() =>
			readHillInput({
				...input,
				scopes: Array.from({ length: 21 }, () => ({ ...scope, id: null }))
			})
		).toThrow();
		for (const name of ['', ' ', 'a'.repeat(81), null])
			expect(() => readHillInput({ ...input, scopes: [{ ...scope, name }] })).toThrow();
		for (const color of ['red', '#fff', 'url(example)', null])
			expect(() => readHillInput({ ...input, scopes: [{ ...scope, color }] })).toThrow();
		expect(() => readHillInput({ ...input, note: 'a'.repeat(2001) })).toThrow();
	});

	it('rejects missing revisions and malformed request bodies', () => {
		for (const revision of [undefined, null, -1, 0.5, '0'])
			expect(() => readHillInput({ ...input, revision })).toThrow();
		for (const body of [null, [], 'hello', {}, { ...input, scopes: [null] }])
			expect(() => readHillInput(body)).toThrow();
	});
});
