import { describe, expect, it } from 'vitest';
import { shareToIssue } from './share.ts';

const share = (title = '', text = '', url = '') => shareToIssue({ title, text, url });

describe('shareToIssue', () => {
	it('uses the shared title and keeps text + url as the description', () => {
		expect(share('Crash on login', 'Steps:\n1. open', 'https://x.test/a')).toEqual({
			title: 'Crash on login',
			description: 'Steps:\n1. open\n\nhttps://x.test/a'
		});
	});

	it('takes the first line of text as the title when there is no title', () => {
		expect(share('', 'Button misaligned\nonly on iPad')).toEqual({
			title: 'Button misaligned',
			description: 'only on iPad'
		});
	});

	it('falls back to the url and does not repeat a url already in the text', () => {
		expect(share('', '', 'https://x.test/b')).toEqual({
			title: 'https://x.test/b',
			description: ''
		});
		expect(share('Look', 'see https://x.test/c', 'https://x.test/c').description).toBe(
			'see https://x.test/c'
		);
	});

	it('caps the title at 200 characters', () => {
		expect(share('', 'a'.repeat(300)).title).toHaveLength(200);
	});
});
