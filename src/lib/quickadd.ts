import { toAppName } from './appname';
import { SIZES, type IssueType, type NewIssue, type NewSubtask, type Size } from './types';

const TYPE_PREFIX: Record<string, IssueType> = {
	bug: 'bug',
	b: 'bug',
	fix: 'bug',
	feat: 'feature',
	feature: 'feature',
	f: 'feature',
	task: 'task',
	t: 'task',
	chore: 'task',
	imp: 'improvement',
	improve: 'improvement',
	improvement: 'improvement',
	enh: 'improvement'
};

const PRIORITY: Record<string, number> = {
	'0': 0,
	p0: 0,
	u: 0,
	urgent: 0,
	'1': 1,
	p1: 1,
	h: 1,
	high: 1,
	'2': 2,
	p2: 2,
	n: 2,
	normal: 2,
	med: 2,
	'3': 3,
	p3: 3,
	l: 3,
	low: 3
};

/**
 * Parses one quick-add line:
 *   `bug: checkout crashes @shop @admin !high +safari -- only on iOS 18`
 * - `bug:` / `feat:` / `task:` / `imp:` prefix sets the type
 * - `@app` picks apps (repeat to file the same issue in several apps)
 * - `!0`..`!3` or `!urgent` `!high` `!normal` `!low` sets priority
 * - `+label` adds labels
 * - `^v1.3` sets the milestone (created if new), `~xs` `~s` `~m` `~l` `~xl` the size
 * - `*fri` `*tomorrow` `*2w` `*nov5` `*2026-11-05` sets the due date (see parseDue)
 * - a leading list bullet (`-`, `*`, `1.`, `- [ ]`) is ignored, so pasted lists work
 * - everything after ` -- ` is the description
 */
export function parseLine(line: string, today = new Date()): NewIssue | null {
	let text = line.trim().replace(BULLET, '');
	if (!text) return null;

	let description = '';
	const sep = text.indexOf(' -- ');
	if (sep >= 0) {
		description = text.slice(sep + 4).trim();
		text = text.slice(0, sep);
	}

	let type: IssueType | undefined;
	const prefix = text.match(/^(\w+):\s*/);
	if (prefix && TYPE_PREFIX[prefix[1].toLowerCase()]) {
		type = TYPE_PREFIX[prefix[1].toLowerCase()];
		text = text.slice(prefix[0].length);
	}

	const apps = new Set<string>();
	const labels = new Set<string>();
	let priority: number | undefined;
	let milestone: string | undefined;
	let size: Size | undefined;
	let dueDate: string | undefined;

	const words = text.split(/\s+/).filter((w) => {
		const app = /^@[\w.-]+$/.test(w) ? toAppName(w.slice(1)) : '';
		if (app) {
			apps.add(app);
			return false;
		}
		if (/^\^[\w.-]+$/.test(w)) {
			milestone = w.slice(1);
			return false;
		}
		const sz = /^~(\w+)$/.exec(w)?.[1].toLowerCase();
		if (sz && SIZES.includes(sz as Size)) {
			size = sz as Size;
			return false;
		}
		const due = /^\*(\S+)$/.exec(w)?.[1];
		if (due && parseDue(due, today)) {
			dueDate = parseDue(due, today)!;
			return false;
		}
		if (/^\+[\w./-]+$/.test(w)) {
			labels.add(w.slice(1).toLowerCase());
			return false;
		}
		const p = /^!(\w+)$/.exec(w)?.[1].toLowerCase();
		if (p && p in PRIORITY) {
			priority = PRIORITY[p];
			return false;
		}
		return true;
	});

	const title = words.join(' ').trim();
	if (!title) return null;

	return {
		title,
		description,
		apps: [...apps],
		type,
		priority,
		labels: [...labels],
		milestone,
		size,
		dueDate
	};
}

/** One issue per non-empty line. */
export function parseQuickAdd(input: string, today = new Date()): NewIssue[] {
	return input
		.split('\n')
		.map((line) => parseLine(line, today))
		.filter((x): x is NewIssue => x !== null);
}

const BULLET = /^(?:[-*•]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/;

export type CaptureItem = NewIssue & { subtasks: NewSubtask[] };

/**
 * Meeting notes → issues. Unindented lines are issues (same syntax as quick add);
 * indented bullet lines are subtasks of the issue above; other indented lines continue
 * the description of whatever came just before.
 */
export function parseCapture(input: string, today = new Date()): CaptureItem[] {
	const items: CaptureItem[] = [];
	let last: { description?: string } | null = null;
	for (const raw of input.split('\n')) {
		if (!raw.trim()) continue;
		const indented = /^\s/.test(raw);
		const parent = items.at(-1);
		if (indented && parent) {
			if (BULLET.test(raw.trim())) {
				const sub = parseLine(raw, today);
				if (sub) {
					// subtasks always follow their parent's app and milestone, so those aren't copied
					const { title, description, type, priority, labels, size, dueDate } = sub;
					const subtask: NewSubtask = { title, description, type, priority, labels, size, dueDate };
					parent.subtasks.push(subtask);
					last = subtask;
				}
			} else if (last) {
				last.description = [last.description, raw.trim()].filter(Boolean).join('\n');
			}
			continue;
		}
		const item = parseLine(raw, today);
		if (item) {
			items.push({ ...item, subtasks: [] });
			last = items.at(-1)!;
		}
	}
	return items;
}

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = [
	'january',
	'february',
	'march',
	'april',
	'may',
	'june',
	'july',
	'august',
	'september',
	'october',
	'november',
	'december'
];
/** `fri`, `thurs`, `friday` → index; needs at least 3 letters */
const nameIndex = (names: string[], word: string) =>
	word.length >= 3 ? names.findIndex((n) => n.startsWith(word)) : -1;

/**
 * Due-date shorthand → YYYY-MM-DD (local date), or null if it isn't one:
 * `today` `tomorrow`/`tmr`, `3d` `2w`, a weekday (`fri`, `friday`: the next one, never today),
 * `nov5` / `5nov` (this year, or next year if already past), `2026-11-05`.
 */
export function parseDue(token: string, today = new Date()): string | null {
	const t = token.toLowerCase();
	const y = today.getFullYear();
	const m = today.getMonth();
	const d = today.getDate();
	const plus = (days: number) => iso(new Date(y, m, d + days));

	if (t === 'today' || t === 'tod') return plus(0);
	if (t === 'tomorrow' || t === 'tmr' || t === 'tom') return plus(1);

	const rel = /^(\d{1,3})([dw])$/.exec(t);
	if (rel) return plus(Number(rel[1]) * (rel[2] === 'w' ? 7 : 1));

	const wd = /^[a-z]+$/.test(t) ? nameIndex(WEEKDAYS, t) : -1;
	if (wd >= 0) return plus(((wd - today.getDay() + 6) % 7) + 1);

	const md = /^([a-z]+)(\d{1,2})$/.exec(t);
	const dm = /^(\d{1,2})([a-z]+)$/.exec(t);
	const [monthName, day] = md ? [md[1], Number(md[2])] : dm ? [dm[2], Number(dm[1])] : ['', 0];
	const month = monthName ? nameIndex(MONTHS, monthName) : -1;
	if (month >= 0) {
		const valid = (year: number) => new Date(year, month, day).getDate() === day;
		if (day < 1 || !valid(y)) return null;
		const past = new Date(y, month, day) < new Date(y, m, d);
		return iso(new Date(past ? y + 1 : y, month, day));
	}

	const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
	if (ymd) {
		const date = new Date(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]));
		return date.getMonth() === Number(ymd[2]) - 1 ? t : null;
	}
	return null;
}
