import type { Status } from './types';

/**
 * Statuses are user-defined, so their meaning is inferred from the closed/default flags and the
 * name. Used for icons and for what counts as "shipped".
 */
export type StatusKind = 'open' | 'draft' | 'progress' | 'review' | 'blocked' | 'done' | 'skipped';

// Closed without shipping, like GitHub's "closed as not planned".
const SKIPPED = /won'?t|wontfix|duplicate|cancel|invalid|reject|obsolete|not planned/i;

export function statusKind(s: Pick<Status, 'name' | 'isClosed' | 'isDefault'>): StatusKind {
	if (s.isClosed) return SKIPPED.test(s.name) ? 'skipped' : 'done';
	if (/block|stuck|waiting/i.test(s.name)) return 'blocked';
	if (/test|review|qa|verif|staging/i.test(s.name)) return 'review';
	if (/backlog|idea|triage|draft|later|someday/i.test(s.name)) return 'draft';
	if (s.isDefault) return 'open';
	if (/progress|doing|active|wip|started|working/i.test(s.name)) return 'progress';
	return 'open';
}

/** Closed in a way that counts as shipped work (not "Won't Fix", "Duplicate", …). */
export const isShipped = (s: Pick<Status, 'name' | 'isClosed' | 'isDefault'> | undefined) =>
	!!s && statusKind(s) === 'done';
