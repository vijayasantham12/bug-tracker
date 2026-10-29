import {
	ENVIRONMENTS,
	SEVERITIES,
	SIZES,
	TYPES,
	type Environment,
	type IssueType,
	type Severity,
	type Size
} from './types';

export const SORTS = [
	'id',
	'title',
	'app',
	'status',
	'priority',
	'type',
	'milestone',
	'size',
	'updated',
	'created'
] as const;
export type Sort = (typeof SORTS)[number];

export const PAGE_SIZE = 100;

export interface Filters {
	apps: string[];
	/** 'open' | 'closed' | 'all' | comma-separated status ids */
	status: string;
	types: IssueType[];
	priorities: number[];
	label: string;
	/** '' any | 'none' | milestone id */
	milestone: string;
	severities: Severity[];
	envs: Environment[];
	/** only subtasks of this issue */
	parent: number | null;
	sizes: Size[];
	overdue: boolean;
	/** due today … in 7 days */
	dueWeek: boolean;
	/** in a status named "Blocked", or blocked by an open issue */
	blocked: boolean;
	q: string;
	sort: Sort;
	dir: 'asc' | 'desc';
	/** 1-based */
	page: number;
}

// junk, negative or absurd values fall back to page 1
const toPage = (v: string | null) => {
	const n = Number(v);
	return Number.isInteger(n) && n > 1 && n <= 100_000 ? n : 1;
};

const list = (v: string | null) => (v ? v.split(',').filter(Boolean) : []);

export function parseFilters(sp: { get(name: string): string | null }): Filters {
	const sort = sp.get('sort') as Sort;
	return {
		apps: list(sp.get('app')),
		status: sp.get('status') || 'open',
		types: list(sp.get('type')).filter((t): t is IssueType => TYPES.includes(t as IssueType)),
		priorities: list(sp.get('p'))
			.map(Number)
			.filter((n) => n >= 0 && n <= 3),
		label: sp.get('label') ?? '',
		milestone: /^(none|\d+)$/.test(sp.get('ms') ?? '') ? sp.get('ms')! : '',
		severities: list(sp.get('sev')).filter((v): v is Severity =>
			SEVERITIES.some((x) => x.value === v)
		),
		envs: list(sp.get('env')).filter((v): v is Environment =>
			ENVIRONMENTS.some((x) => x.value === v)
		),
		parent: Number(sp.get('parent')) > 0 ? Math.floor(Number(sp.get('parent'))) : null,
		sizes: list(sp.get('size')).filter((v): v is Size => SIZES.includes(v as Size)),
		overdue: sp.get('due') === 'overdue',
		dueWeek: sp.get('due') === 'week',
		blocked: sp.get('blocked') === '1',
		q: sp.get('q') ?? '',
		sort: SORTS.includes(sort) ? sort : 'id',
		dir: sp.get('dir') === 'asc' ? 'asc' : 'desc',
		page: toPage(sp.get('page'))
	};
}

/** Builds a query string, omitting defaults so URLs stay short. */
export function filtersToQuery(f: Filters): string {
	const sp = new URLSearchParams();
	if (f.apps.length) sp.set('app', f.apps.join(','));
	if (f.status !== 'open') sp.set('status', f.status);
	if (f.types.length) sp.set('type', f.types.join(','));
	if (f.priorities.length) sp.set('p', f.priorities.join(','));
	if (f.label) sp.set('label', f.label);
	if (f.milestone) sp.set('ms', f.milestone);
	if (f.severities.length) sp.set('sev', f.severities.join(','));
	if (f.envs.length) sp.set('env', f.envs.join(','));
	if (f.parent) sp.set('parent', String(f.parent));
	if (f.sizes.length) sp.set('size', f.sizes.join(','));
	if (f.overdue) sp.set('due', 'overdue');
	else if (f.dueWeek) sp.set('due', 'week');
	if (f.blocked) sp.set('blocked', '1');
	if (f.q) sp.set('q', f.q);
	if (f.sort !== 'id') sp.set('sort', f.sort);
	if (f.dir !== 'desc') sp.set('dir', f.dir);
	if (f.page > 1) sp.set('page', String(f.page));
	const s = sp.toString();
	return s ? `?${s}` : '';
}
