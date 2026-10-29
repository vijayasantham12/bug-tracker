export const TYPES = ['bug', 'feature', 'task', 'improvement'] as const;
export type IssueType = (typeof TYPES)[number];

export const TYPE_LABEL: Record<IssueType, string> = {
	bug: 'Bug',
	feature: 'Feature',
	task: 'Task',
	improvement: 'Improve'
};

export const PRIORITIES = [
	{ value: 0, label: 'Urgent', short: 'P0' },
	{ value: 1, label: 'High', short: 'P1' },
	{ value: 2, label: 'Normal', short: 'P2' },
	{ value: 3, label: 'Low', short: 'P3' }
] as const;

export const SIZES = ['xs', 's', 'm', 'l', 'xl'] as const;
export type Size = (typeof SIZES)[number];

export const SEVERITIES = [
	{ value: 'critical', label: 'Critical' },
	{ value: 'major', label: 'Major' },
	{ value: 'minor', label: 'Minor' },
	{ value: 'trivial', label: 'Trivial' }
] as const;
export type Severity = (typeof SEVERITIES)[number]['value'];

export const ENVIRONMENTS = [
	{ value: 'production', label: 'Production', short: 'prod' },
	{ value: 'staging', label: 'Staging', short: 'staging' },
	{ value: 'local', label: 'Local', short: 'local' }
] as const;
export type Environment = (typeof ENVIRONMENTS)[number]['value'];

/** What the issue page offers; stored as (from, to, kind) in issue_relations. */
export const RELATION_KINDS = [
	{ value: 'relates', label: 'related to' },
	{ value: 'blocks', label: 'blocks' },
	{ value: 'blocked_by', label: 'blocked by' },
	{ value: 'duplicates', label: 'duplicates' },
	{ value: 'duplicated_by', label: 'duplicated by' }
] as const;
export type RelationKind = (typeof RELATION_KINDS)[number]['value'];

export interface App {
	id: number;
	name: string;
	color: string;
	archived: boolean;
	openCount: number;
	totalCount: number;
}

export interface Milestone {
	id: number;
	name: string;
	dueDate: string | null;
	done: boolean;
	openCount: number;
	totalCount: number;
}

export interface Status {
	id: number;
	name: string;
	color: string;
	position: number;
	isClosed: boolean;
	isDefault: boolean;
}

export interface Issue {
	id: number;
	appId: number;
	appName: string;
	appColor: string;
	type: IssueType;
	title: string;
	description: string;
	statusId: number;
	priority: number;
	labels: string[];
	version: string | null;
	fixedIn: string | null;
	dueDate: string | null;
	milestoneId: number | null;
	milestoneName: string | null;
	parentId: number | null;
	size: Size | null;
	severity: Severity | null;
	environment: Environment | null;
	createdAt: Date;
	updatedAt: Date;
	closedAt: Date | null;
	subtaskCount: number;
	subtaskDone: number;
	/** blocked by at least one open issue */
	isBlocked: boolean;
	/** pending "remind me" (sent to whoever set it) */
	remindAt: Date | null;
	commentCount: number;
	attachmentCount: number;
	createdByName: string | null;
}

/** A linked issue as seen from the current one, e.g. "blocked by #12". */
export interface Relation {
	id: number;
	kind: RelationKind;
	otherId: number;
	otherTitle: string;
	otherClosed: boolean;
}

export interface IssueLink {
	id: number;
	url: string;
	title: string | null;
}

/** Minimal issue row for parent / subtask lists. */
export interface IssueRef {
	id: number;
	title: string;
	statusId: number;
	isClosed: boolean;
}

export interface Attachment {
	id: number;
	filename: string;
	mime: string;
	size: number;
	createdAt: Date;
}

export interface IssueEvent {
	id: number;
	kind: 'comment' | 'change';
	field: string | null;
	oldValue: string | null;
	newValue: string | null;
	body: string | null;
	userId: number | null;
	userName: string | null;
	createdAt: Date;
}

export interface NewIssue {
	title: string;
	description?: string;
	/** App names; unknown names are created. One issue is created per app. */
	apps: string[];
	type?: IssueType;
	priority?: number;
	labels?: string[];
	/** Milestone name; unknown names are created. */
	milestone?: string;
	size?: Size;
	/** YYYY-MM-DD */
	dueDate?: string;
	parentId?: number;
	/** created under each issue made from this item, in the same app and milestone */
	subtasks?: NewSubtask[];
}

export type NewSubtask = Omit<NewIssue, 'apps' | 'milestone' | 'parentId' | 'subtasks'>;

export type IssuePatch = Partial<{
	title: string;
	description: string;
	appId: number;
	type: IssueType;
	statusId: number;
	priority: number;
	labels: string[];
	version: string | null;
	fixedIn: string | null;
	dueDate: string | null;
	milestoneId: number | null;
	parentId: number | null;
	size: Size | null;
	severity: Severity | null;
	environment: Environment | null;
	/** ISO time for "remind me", or null to cancel; handled outside updateIssue */
	remindAt: string | null;
}>;

export type Role = 'admin' | 'member';

export interface User {
	id: number;
	email: string;
	name: string;
	role: Role;
}

/** An open issue whose title looks like one being typed (duplicate hint). */
export interface SimilarIssue {
	id: number;
	title: string;
	statusName: string;
}

/** Per-user notification switches; missing keys fall back to NOTIFY_DEFAULTS. */
export interface NotifyPrefs {
	/** "remind me" on an issue */
	reminders: boolean;
	/** daily summary: due today, overdue, milestones due tomorrow */
	digest: boolean;
	/** HH:MM in the user's timezone */
	digestTime: string;
	/** an issue's last open blocker was closed */
	unblocked: boolean;
	/** someone else commented on an issue you created or commented on */
	comments: boolean;
	/** someone else changed the status of an issue you created */
	status: boolean;
	/** someone else filed (or escalated) a critical/major production bug */
	prodBugs: boolean;
}

export const NOTIFY_DEFAULTS: NotifyPrefs = {
	reminders: true,
	digest: true,
	digestTime: '09:00',
	unblocked: true,
	comments: true,
	status: true,
	prodBugs: true
};

export interface PushDevice {
	id: number;
	device: string | null;
	createdAt: Date;
}

export interface InboxNotification {
	id: number;
	title: string;
	body: string;
	url: string;
	createdAt: Date;
	readAt: Date | null;
}
