import { describe, it, expect } from 'vitest';
import { renderMarkdown } from './markdown';

describe('renderMarkdown', () => {
	it('escapes raw HTML', () => {
		const html = renderMarkdown('<img src=x onerror=alert(1)> <script>alert(1)</script>');
		expect(html).not.toContain('<img');
		expect(html).not.toContain('<script');
		expect(html).toContain('&lt;script&gt;');
	});

	it('drops javascript: and other unsafe links', () => {
		expect(renderMarkdown('[x](javascript:alert(1))')).not.toContain('href');
		expect(renderMarkdown('[x](data:text/html,<b>hi</b>)')).not.toContain('href');
		expect(renderMarkdown('![x](javascript:alert(1))')).not.toContain('<img');
	});

	it('opens links in a new tab', () => {
		expect(renderMarkdown('see https://example.com')).toContain(
			'<a href="https://example.com" target="_blank" rel="noopener noreferrer">'
		);
	});

	it('keeps single line breaks', () => {
		expect(renderMarkdown('one\ntwo')).toContain('one<br>\ntwo');
	});

	it('renders task lists as read-only checkboxes', () => {
		const html = renderMarkdown('- [ ] todo\n- [x] done\n- plain');
		expect(html).toContain('<li class="task"><input type="checkbox" disabled> todo</li>');
		expect(html).toContain('<li class="task"><input type="checkbox" disabled checked> done</li>');
		expect(html).toContain('<li>plain</li>');
	});

	it('renders tables and fenced code', () => {
		expect(renderMarkdown('| a | b |\n|---|---|\n| 1 | 2 |')).toContain('<td>1</td>');
		expect(renderMarkdown('```\n<b>x</b>\n```')).toContain('<pre><code>&lt;b&gt;x&lt;/b&gt;');
	});
});
