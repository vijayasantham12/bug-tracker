import { error } from '@sveltejs/kit';
import { parseLine } from '#lib/quickadd.ts';
import { fileSize } from '#lib/format.ts';
import { parseFilters, SORTS, type Sort } from '#lib/filters.ts';
import {
	ENVIRONMENTS,
	PRIORITIES,
	RELATION_KINDS,
	SEVERITIES,
	TYPES,
	type Issue,
	type IssuePatch,
	type User
} from '#lib/types.ts';
import {
	addComment,
	createIssues,
	getAttachment,
	getIssue,
	listAttachments,
	listEvents,
	listIssues,
	listLinks,
	listMilestones,
	listRelations,
	listStatuses,
	listSubtasks,
	updateIssue
} from './repo';
import { cleanNewIssues } from './validate';
import { afterComment, afterIssueChanged, afterIssuesCreated } from './notify';
import { getObject, s3Enabled, signedUrl } from './s3';

/**
 * Tools for Claude Code (or any MCP client) over /api/mcp: list, read (with attachments),
 * create, update, comment on and close issues, acting as the API token's user.
 */

export type Content =
	{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string };

export interface Tool {
	name: string;
	description: string;
	inputSchema: object;
	run(args: Record<string, unknown>, ctx: { user: User; origin: string }): Promise<Content[]>;
}

const text = (t: string): Content[] => [{ type: 'text', text: t }];

// images Claude can read; bigger ones would be rejected by the model API anyway
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const MAX_IMAGE_BYTES = 3.5 * 1024 * 1024;
const MAX_IMAGES = 10;
const MAX_TEXT_CHARS = 100_000;
const TEXT_EXT =
	/\.(txt|log|md|csv|tsv|json|ndjson|ya?ml|xml|har|html?|css|js|mjs|ts|tsx|jsx|svelte|py|rb|go|rs|java|kt|swift|sql|sh|env|ini|toml|conf|diff|patch|svg|trace|stack)$/i;

const isText = (mime: string, filename: string) =>
	mime.startsWith('text/') || /json|xml|yaml|javascript|svg/.test(mime) || TEXT_EXT.test(filename);

const priorityLabel = (p: number) => `P${p} ${PRIORITIES[p]?.label ?? ''}`.trim();
const stamp = (d: Date) => d.toISOString().slice(0, 16).replace('T', ' ');

function parsePriority(v: unknown): number | undefined {
	if (v === undefined || v === null || v === '') return undefined;
	const s = String(v).toLowerCase().replace(/^p/, '');
	const n = /^\d$/.test(s) ? Number(s) : PRIORITIES.findIndex((p) => p.label.toLowerCase() === s);
	if (!(n >= 0 && n <= 3)) error(400, `Unknown priority: ${v} (use 0-3 or urgent/high/normal/low)`);
	return n;
}

async function statusByName(name: string) {
	const statuses = await listStatuses();
	const s = statuses.find((x) => x.name.toLowerCase() === name.trim().toLowerCase());
	if (!s)
		error(400, `Unknown status "${name}". Statuses: ${statuses.map((x) => x.name).join(', ')}`);
	return s;
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const labelsArg = (v: unknown) =>
	Array.isArray(v) ? v.map(String) : typeof v === 'string' ? v.split(',') : undefined;

function issueId(args: Record<string, unknown>) {
	const id = Number(String(args.id ?? '').replace(/^#/, ''));
	if (!Number.isInteger(id) || id <= 0) error(400, 'Pass the issue number as id, e.g. 123');
	return id;
}

async function requireIssue(id: number) {
	const issue = await getIssue(id);
	if (!issue) error(404, `Issue #${id} not found`);
	return issue;
}

function summaryLine(i: Issue, statusName: string) {
	const extra = [
		i.dueDate && `due ${i.dueDate}`,
		i.isBlocked && 'blocked',
		i.severity && i.severity,
		i.environment && i.environment,
		i.labels.length && i.labels.map((l) => `+${l}`).join(' '),
		i.milestoneName && `^${i.milestoneName}`,
		i.attachmentCount && `${i.attachmentCount} attachment${i.attachmentCount === 1 ? '' : 's'}`,
		i.commentCount && `${i.commentCount} comment${i.commentCount === 1 ? '' : 's'}`
	].filter(Boolean);
	return `#${i.id} [${i.type} · P${i.priority} · ${statusName}] @${i.appName} — ${i.title}${extra.length ? ` (${extra.join(', ')})` : ''}`;
}

const listIssuesTool: Tool = {
	name: 'list_issues',
	description:
		'Search or list issues in the bug tracker. Defaults to open issues, most recently updated first. Use get_issue for full details of one issue.',
	inputSchema: {
		type: 'object',
		properties: {
			query: {
				type: 'string',
				description: 'Full-text search over title, description and comments, or "#123"'
			},
			app: { type: 'string', description: 'App name, e.g. "shop"' },
			status: {
				type: 'string',
				description: '"open" (default), "closed", "all", or a status name like "In Progress"'
			},
			type: { type: 'string', enum: [...TYPES] },
			priority: {
				type: 'string',
				description: 'Only this priority: 0-3 or urgent/high/normal/low'
			},
			label: { type: 'string' },
			milestone: { type: 'string', description: 'Milestone name' },
			sort: { type: 'string', enum: ['updated', 'priority', 'created', 'id'] },
			limit: { type: 'number', description: 'Max results, default 30, at most 100' }
		}
	},
	async run(args) {
		const f = parseFilters(new URLSearchParams());
		const app = str(args.app);
		if (app) f.apps = [app];
		const status = str(args.status)?.toLowerCase() ?? 'open';
		f.status = ['open', 'closed', 'all'].includes(status)
			? status
			: String((await statusByName(status)).id);
		if (str(args.type)) f.types = [args.type as never];
		const p = parsePriority(args.priority);
		if (p !== undefined) f.priorities = [p];
		f.label = str(args.label)?.toLowerCase() ?? '';
		const ms = str(args.milestone);
		if (ms) {
			const m = (await listMilestones()).find((x) => x.name.toLowerCase() === ms.toLowerCase());
			if (!m) return text(`No milestone named "${ms}".`);
			f.milestone = String(m.id);
		}
		f.q = str(args.query) ?? '';
		const sort = (str(args.sort) ?? (f.q ? 'id' : 'updated')) as Sort;
		f.sort = SORTS.includes(sort) ? sort : 'updated';
		f.dir = f.sort === 'priority' ? 'asc' : 'desc';
		f.limit = Math.min(100, Math.max(1, Number(args.limit) || 30));

		const [{ issues, total }, statuses] = await Promise.all([listIssues(f), listStatuses()]);
		if (!issues.length) return text('No matching issues.');
		const statusName = new Map(statuses.map((s) => [s.id, s.name]));
		const lines = issues.map((i) => summaryLine(i, statusName.get(i.statusId) ?? '?'));
		if (total > issues.length)
			lines.push(`… ${total - issues.length} more; narrow the search or raise limit.`);
		return text(lines.join('\n'));
	}
};

const getIssueTool: Tool = {
	name: 'get_issue',
	description:
		'Read one issue completely: fields, description, comments, change history, links, related issues, subtasks, and its attachments (screenshots are returned as images, logs and other text files as text). Use this before investigating or fixing an issue.',
	inputSchema: {
		type: 'object',
		properties: {
			id: { type: 'number', description: 'Issue number, e.g. 123' },
			attachments: {
				type: 'boolean',
				description: 'Include attachment contents (default true)'
			}
		},
		required: ['id']
	},
	async run(args, { origin }) {
		const id = issueId(args);
		const issue = await requireIssue(id);
		const [statuses, events, links, relations, subtasks, files, parent] = await Promise.all([
			listStatuses(),
			listEvents(id),
			listLinks(id),
			listRelations(id),
			listSubtasks(id),
			listAttachments(id),
			issue.parentId ? getIssue(issue.parentId) : null
		]);
		const status = statuses.find((s) => s.id === issue.statusId);
		const relLabel = (k: string) => RELATION_KINDS.find((r) => r.value === k)?.label ?? k;

		const facts = [
			issue.type,
			priorityLabel(issue.priority),
			`status ${status?.name}${status?.isClosed ? ' (closed)' : ''}`,
			`app ${issue.appName}`,
			issue.milestoneName && `milestone ${issue.milestoneName}`,
			issue.size && `size ${issue.size.toUpperCase()}`,
			issue.severity && `severity ${issue.severity}`,
			issue.environment && `environment ${issue.environment}`,
			issue.version && `found in ${issue.version}`,
			issue.fixedIn && `fixed in ${issue.fixedIn}`,
			issue.dueDate && `due ${issue.dueDate}`,
			issue.repeat && `repeats ${issue.repeat}`,
			issue.isBlocked && 'BLOCKED by an open issue',
			issue.labels.length && `labels ${issue.labels.join(', ')}`
		].filter(Boolean);

		const out: string[] = [
			`# #${issue.id} ${issue.title}`,
			facts.join(' · '),
			`Created ${stamp(issue.createdAt)}${issue.createdByName ? ` by ${issue.createdByName}` : ''} · updated ${stamp(issue.updatedAt)}${issue.closedAt ? ` · closed ${stamp(issue.closedAt)}` : ''}`,
			`${origin}/issues/${issue.id}`
		];
		if (parent) out.push(`Parent: #${parent.id} ${parent.title}`);
		if (subtasks.length)
			out.push(
				'',
				'## Subtasks',
				...subtasks.map((s) => `- [${s.isClosed ? 'x' : ' '}] #${s.id} ${s.title}`)
			);
		if (relations.length)
			out.push(
				'',
				'## Related issues',
				...relations.map(
					(r) =>
						`- ${relLabel(r.kind)} #${r.otherId} ${r.otherTitle}${r.otherClosed ? ' (closed)' : ''}`
				)
			);
		if (links.length)
			out.push('', '## Links', ...links.map((l) => `- ${l.title ? `${l.title}: ` : ''}${l.url}`));
		out.push('', '## Description', issue.description.trim() || '(none)');

		const activity = events
			.filter((e) => e.kind === 'comment' || e.field !== 'description')
			.map((e) => {
				const who = e.userName ?? 'someone';
				if (e.kind === 'comment')
					return `- ${stamp(e.createdAt)} ${who} commented:\n${(e.body ?? '').replace(/^/gm, '  ')}`;
				const change =
					e.oldValue && e.newValue
						? `${e.oldValue} → ${e.newValue}`
						: e.newValue
							? `+ ${e.newValue}`
							: `− ${e.oldValue ?? ''}`;
				return `- ${stamp(e.createdAt)} ${who}: ${e.field} ${change}`;
			});
		if (activity.length) out.push('', '## Activity (oldest first)', ...activity);

		const content: Content[] = [];
		if (files.length) {
			out.push('', `## Attachments (${files.length})`);
			const include = args.attachments !== false && s3Enabled;
			let images = 0;
			for (const [n, f] of files.entries()) {
				const label = `${n + 1}. ${f.filename} (${f.mime}, ${fileSize(f.size)})`;
				if (!include) {
					out.push(label);
					continue;
				}
				const textual = isText(f.mime, f.filename);
				const image = IMAGE_TYPES.includes(f.mime);
				if ((image && f.size <= MAX_IMAGE_BYTES && images < MAX_IMAGES) || textual) {
					const row = await getAttachment(f.id);
					const body = row ? await getObject(row.key).catch(() => null) : null;
					if (body && image) {
						images++;
						out.push(`${label}: image below`);
						content.push(
							{ type: 'text', text: `Attachment ${n + 1}: ${f.filename}` },
							{ type: 'image', data: Buffer.from(body).toString('base64'), mimeType: f.mime }
						);
						continue;
					}
					if (body && textual) {
						let t = new TextDecoder().decode(body);
						const cut = t.length > MAX_TEXT_CHARS;
						if (cut) t = t.slice(-MAX_TEXT_CHARS);
						out.push(`${label}: contents below`);
						content.push({
							type: 'text',
							text: `Attachment ${n + 1}: ${f.filename}${cut ? ` (last ${MAX_TEXT_CHARS} characters)` : ''}\n\`\`\`\n${t}\n\`\`\``
						});
						continue;
					}
				}
				// videos, PDFs, HEIC, huge images: a short-lived link to fetch it if needed
				const row = await getAttachment(f.id);
				const url = row ? await signedUrl(row.key, f.filename, false).catch(() => null) : null;
				out.push(`${label}${url ? `: not inlined; download within 5 minutes from ${url}` : ''}`);
			}
		}
		return [{ type: 'text', text: out.join('\n') }, ...content];
	}
};

const createIssueTool: Tool = {
	name: 'create_issue',
	description:
		'File a new issue. The title may use quick-add tokens: "bug:"/"feat:"/"task:"/"imp:" prefix, @app, !high, +label, ^milestone, ~size, *fri (due). Without an app it goes to Inbox.',
	inputSchema: {
		type: 'object',
		properties: {
			title: { type: 'string' },
			description: { type: 'string', description: 'Markdown' },
			app: { type: 'string', description: 'App name; created if new' },
			type: { type: 'string', enum: [...TYPES] },
			priority: { type: 'string', description: '0-3 or urgent/high/normal/low (default normal)' },
			labels: { type: 'array', items: { type: 'string' } },
			milestone: { type: 'string' },
			parent_id: { type: 'number', description: 'Make it a subtask of this issue' },
			severity: { type: 'string', enum: SEVERITIES.map((s) => s.value) },
			environment: { type: 'string', enum: ENVIRONMENTS.map((e) => e.value) }
		},
		required: ['title']
	},
	async run(args, { user, origin }) {
		const parsed = parseLine(String(args.title ?? '').split('\n')[0]);
		if (!parsed) error(400, 'The title is empty');
		const app = str(args.app) ?? parsed.apps[0];
		const [item] = cleanNewIssues([
			{
				...parsed,
				apps: str(args.app) ? [app] : parsed.apps.length ? parsed.apps : app ? [app] : [],
				description: [parsed.description, str(args.description)].filter(Boolean).join('\n\n'),
				type: (str(args.type) as never) ?? parsed.type,
				priority: parsePriority(args.priority) ?? parsed.priority,
				labels: [...(parsed.labels ?? []), ...(labelsArg(args.labels) ?? [])],
				milestone: str(args.milestone) ?? parsed.milestone,
				parentId: args.parent_id ? Number(args.parent_id) : undefined
			}
		]);
		if (!item) error(400, 'The title is empty');
		const { ids } = await createIssues([item], user.id);
		const patch: IssuePatch = {};
		if (str(args.severity)) patch.severity = args.severity as never;
		if (str(args.environment)) patch.environment = args.environment as never;
		if (Object.keys(patch).length) for (const id of ids) await updateIssue(id, patch, user.id);
		afterIssuesCreated(ids, user.id);
		return text(ids.map((id) => `Created #${id}: ${origin}/issues/${id}`).join('\n'));
	}
};

const updateIssueTool: Tool = {
	name: 'update_issue',
	description:
		'Change fields of an issue: status, priority, labels, fixed_in version, title or description.',
	inputSchema: {
		type: 'object',
		properties: {
			id: { type: 'number' },
			status: { type: 'string', description: 'Status name, e.g. "In Progress"' },
			priority: { type: 'string', description: '0-3 or urgent/high/normal/low' },
			labels: { type: 'array', items: { type: 'string' }, description: 'Replaces all labels' },
			fixed_in: { type: 'string' },
			title: { type: 'string' },
			description: { type: 'string', description: 'Replaces the description (Markdown)' }
		},
		required: ['id']
	},
	async run(args, { user }) {
		const id = issueId(args);
		await requireIssue(id);
		const patch: IssuePatch = {};
		if (str(args.status)) patch.statusId = (await statusByName(String(args.status))).id;
		const p = parsePriority(args.priority);
		if (p !== undefined) patch.priority = p;
		if (labelsArg(args.labels)) patch.labels = labelsArg(args.labels);
		if (str(args.fixed_in)) patch.fixedIn = str(args.fixed_in)!;
		if (str(args.title)) patch.title = str(args.title)!;
		if (typeof args.description === 'string') patch.description = args.description;
		const changes = (await updateIssue(id, patch, user.id)) ?? [];
		afterIssueChanged(id, changes, user.id);
		return text(
			changes.length
				? `Updated #${id}: ${changes.map((c) => c.field).join(', ')}`
				: `#${id} unchanged`
		);
	}
};

const addCommentTool: Tool = {
	name: 'add_comment',
	description:
		'Add a Markdown comment to an issue, e.g. the root cause you found or what you changed.',
	inputSchema: {
		type: 'object',
		properties: { id: { type: 'number' }, body: { type: 'string' } },
		required: ['id', 'body']
	},
	async run(args, { user }) {
		const id = issueId(args);
		await requireIssue(id);
		const body = String(args.body ?? '').trim();
		if (!body) error(400, 'The comment is empty');
		await addComment(id, body, user.id);
		afterComment(id, body, user);
		return text(`Commented on #${id}`);
	}
};

const closeIssueTool: Tool = {
	name: 'close_issue',
	description:
		'Close an issue, optionally with a closing comment (what was fixed and how) and the version it is fixed in.',
	inputSchema: {
		type: 'object',
		properties: {
			id: { type: 'number' },
			comment: { type: 'string', description: 'Markdown, e.g. the root cause and the fix' },
			fixed_in: { type: 'string', description: 'Version or commit' },
			status: {
				type: 'string',
				description:
					'A closed status name, e.g. "Won\'t Fix"; defaults to the first closed status (Done)'
			}
		},
		required: ['id']
	},
	async run(args, { user }) {
		const id = issueId(args);
		const issue = await requireIssue(id);
		const statuses = await listStatuses();
		const target = str(args.status)
			? await statusByName(String(args.status))
			: statuses.find((s) => s.isClosed);
		if (!target?.isClosed) error(400, `"${target?.name ?? args.status}" is not a closed status`);
		const comment = str(args.comment);
		if (comment) {
			await addComment(id, comment, user.id);
			afterComment(id, comment, user);
		}
		const patch: IssuePatch = { statusId: target.id };
		if (str(args.fixed_in)) patch.fixedIn = str(args.fixed_in)!;
		const changes = (await updateIssue(id, patch, user.id)) ?? [];
		afterIssueChanged(id, changes, user.id);
		const was = statuses.find((s) => s.id === issue.statusId);
		return text(
			was?.isClosed && was.id === target.id
				? `#${id} was already ${target.name}${comment ? '; comment added' : ''}`
				: `Closed #${id} as ${target.name}${issue.repeat ? ` (repeats ${issue.repeat}: the next one was created)` : ''}`
		);
	}
};

export const TOOLS: Tool[] = [
	listIssuesTool,
	getIssueTool,
	createIssueTool,
	updateIssueTool,
	addCommentTool,
	closeIssueTool
];
