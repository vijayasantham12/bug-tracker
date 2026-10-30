import { MIN_PASSWORD } from './auth';
import { toAppName } from '#lib/appname.ts';
import { PRIORITIES, TYPES, type IssueType, type NewIssue, type NewSubtask } from '#lib/types.ts';

export function readAccountForm(form: FormData) {
	const email = String(form.get('email') ?? '').trim();
	const name = String(form.get('name') ?? '').trim();
	const password = String(form.get('password') ?? '');
	let message = '';
	if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) message = 'Enter a valid email';
	else if (!name) message = 'Enter your name';
	else if (password.length < MIN_PASSWORD)
		message = `Password must be at least ${MIN_PASSWORD} characters`;
	return { email, name, password, message };
}

/** Only same-site relative paths, so `?next=` can't redirect off-site. */
export function safeNext(next: string | null) {
	return next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_SUBTASKS = 50;

function cleanFields<T extends NewSubtask>(it: T, fallbackType: IssueType) {
	return {
		...it,
		title: typeof it.title === 'string' ? it.title.trim() : '',
		description: typeof it.description === 'string' ? it.description : '',
		type: TYPES.includes(it.type!) ? it.type : fallbackType,
		priority: PRIORITIES.some((p) => p.value === it.priority) ? it.priority : undefined,
		labels: Array.isArray(it.labels)
			? it.labels
					.filter((l) => typeof l === 'string' && l.trim())
					.map((l) => l.trim().toLowerCase())
			: [],
		dueDate: typeof it.dueDate === 'string' && DATE.test(it.dueDate) ? it.dueDate : undefined
	};
}

/** Untrusted create payload → titled items; an empty app list goes to Inbox. */
export function cleanNewIssues(items: unknown): NewIssue[] {
	if (!Array.isArray(items)) return [];
	return (items as NewIssue[])
		.filter((it) => it && typeof it === 'object')
		.map((it) => {
			const apps = [
				...new Set(
					(Array.isArray(it.apps) ? it.apps : []).map((a) => toAppName(String(a))).filter(Boolean)
				)
			];
			return {
				...cleanFields(it, apps.length ? 'bug' : 'task'),
				apps,
				milestone: typeof it.milestone === 'string' ? it.milestone.trim() || undefined : undefined,
				parentId: Number.isInteger(it.parentId) ? it.parentId : undefined,
				subtasks: (Array.isArray(it.subtasks) ? it.subtasks : [])
					.slice(0, MAX_SUBTASKS)
					.map((sub) => cleanFields(sub, 'task'))
					.filter((sub) => sub.title)
			};
		})
		.filter((it) => it.title);
}
