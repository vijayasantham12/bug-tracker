import { describe, it, expect } from 'vitest';
import { toAppName } from './appname';

describe('toAppName', () => {
	it('lowercases and replaces spaces and other characters with dashes', () => {
		expect(toAppName('Admin Panel')).toBe('admin-panel');
		expect(toAppName('  My App!! v2 ')).toBe('my-app-v2');
		expect(toAppName('api.v2_beta')).toBe('api.v2_beta');
	});

	it('trims separators at the ends, but keeps a trailing one while typing', () => {
		expect(toAppName('-shop-')).toBe('shop');
		expect(toAppName('admin ', true)).toBe('admin-');
	});

	it('returns empty when nothing usable is left', () => {
		expect(toAppName('!!!')).toBe('');
	});

	it('caps the length', () => {
		expect(toAppName('a'.repeat(60))).toHaveLength(40);
	});
});
