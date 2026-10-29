import { parseDue } from './quickadd';

/** Autocomplete for quick-add tokens: `@app`, `^milestone`, `+label`, `*due`. */
export type Sigil = '@' | '^' | '+' | '*';

export interface Token {
	sigil: Sigil;
	partial: string;
	/** where the sigil is */
	start: number;
	/** end of the word under the caret */
	end: number;
}

export interface Suggestion {
	value: string;
	hint?: string;
}

export interface Sources {
	apps: string[];
	milestones: string[];
	labels: string[];
}

/** The token being typed at `caret`, if any. A `*` that starts a line is a bullet, not a date. */
export function tokenAt(text: string, caret: number): Token | null {
	const before = text.slice(0, caret);
	const m = /(^|\s)([@^+*])([\w.-]*)$/.exec(before);
	if (!m) return null;
	const start = caret - m[3].length - 1;
	if (m[2] === '*' && /^\s*$/.test(text.slice(text.lastIndexOf('\n', start - 1) + 1, start)))
		return null;
	const rest = /^[\w.-]*/.exec(text.slice(caret))![0];
	return { sigil: m[2] as Sigil, partial: m[3].toLowerCase(), start, end: caret + rest.length };
}

const DUE_WORDS = ['today', 'tomorrow', 'mon', 'tue', 'wed', 'thu', 'fri', '1w', '2w'];
const MAX = 6;

const dueHint = (iso: string) =>
	new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, {
		weekday: 'short',
		day: 'numeric',
		month: 'short'
	});

export function suggest(token: Token, sources: Sources, today = new Date()): Suggestion[] {
	const p = token.partial;
	if (token.sigil === '*') {
		const words = DUE_WORDS.filter((w) => w.startsWith(p));
		// anything else that parses (nov5, 3d, friday…) is offered as typed
		if (p && !words.includes(p) && parseDue(p, today)) words.unshift(p);
		return words
			.slice(0, MAX)
			.map((w) => ({ value: w, hint: dueHint(parseDue(w, today)!) }))
			.filter((s) => s.hint);
	}
	const names =
		token.sigil === '@' ? sources.apps : token.sigil === '^' ? sources.milestones : sources.labels;
	const lower = names.map((n) => [n, n.toLowerCase()] as const);
	const prefix = lower.filter(([, l]) => l.startsWith(p));
	const inside = lower.filter(([, l]) => !l.startsWith(p) && l.includes(p));
	return [...prefix, ...inside].slice(0, MAX).map(([n]) => ({ value: n }));
}

/** Replaces the token with the chosen value plus one space; returns the new text and caret. */
export function applySuggestion(text: string, token: Token, value: string) {
	const tail = text.slice(token.end).replace(/^ /, '');
	const head = `${text.slice(0, token.start)}${token.sigil}${value} `;
	return { text: head + tail, caret: head.length };
}
