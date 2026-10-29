import MarkdownIt from 'markdown-it';

/**
 * GitHub-flavoured-ish Markdown for descriptions and comments.
 * Safe for {@html} with text from other users: `html: false` escapes raw HTML, and
 * markdown-it's link validation drops javascript:/vbscript:/file:/non-image data: URLs.
 * `breaks` keeps single newlines, so text written before Markdown still reads the same.
 */
const md = new MarkdownIt({ html: false, linkify: true, breaks: true });

const renderLinkOpen =
	md.renderer.rules.link_open ??
	((tokens, idx, opts, _env, self) => self.renderToken(tokens, idx, opts));
md.renderer.rules.link_open = (tokens, idx, opts, env, self) => {
	tokens[idx].attrSet('target', '_blank');
	tokens[idx].attrSet('rel', 'noopener noreferrer');
	return renderLinkOpen(tokens, idx, opts, env, self);
};

// `- [ ] todo` / `- [x] done` → read-only checkboxes (pushed last so text tokens are already joined)
md.core.ruler.push('task_list', (state) => {
	const tokens = state.tokens;
	for (let i = 2; i < tokens.length; i++) {
		const inline = tokens[i];
		if (
			inline.type !== 'inline' ||
			tokens[i - 1].type !== 'paragraph_open' ||
			tokens[i - 2].type !== 'list_item_open'
		)
			continue;
		const text = inline.children?.[0];
		const m = text?.type === 'text' ? /^\[([ xX])\] /.exec(text.content) : null;
		if (!text || !m) continue;
		text.content = text.content.slice(m[0].length);
		const box = new state.Token('html_inline', '', 0);
		box.content = `<input type="checkbox" disabled${m[1] === ' ' ? '' : ' checked'}> `;
		inline.children!.unshift(box);
		tokens[i - 2].attrJoin('class', 'task');
	}
});

export const renderMarkdown = (source: string) => md.render(source);
