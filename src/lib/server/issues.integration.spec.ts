import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import schema from './schema.sql?raw';
import { parseFilters } from '#lib/filters.ts';
import type { IssuePatch } from '#lib/types.ts';

// Explicit opt-in; every query runs in a fresh, isolated schema, never the app's tables.
const harness = await vi.hoisted(async () => {
	const { default: postgres } = await import('postgres');
	const { randomUUID } = await import('node:crypto');
	const namespace = `test_issues_${randomUUID().replaceAll('-', '')}`;
	return {
		enabled: Boolean(process.env.BUG_TRACKER_TEST_DATABASE_URL),
		namespace,
		sql: postgres(
			process.env.BUG_TRACKER_TEST_DATABASE_URL || 'postgres://unused@localhost/unused',
			{
				transform: postgres.camel,
				connection: { search_path: namespace },
				onnotice: () => {},
				connect_timeout: 5
			}
		)
	};
});
const storage = vi.hoisted(() => ({ enabled: false, remove: vi.fn() }));
vi.mock('./db', () => ({ sql: harness.sql }));
vi.mock('./push', () => ({ notifyUsers: vi.fn() }));
vi.mock('./backup', () => ({ backupIfDue: vi.fn() }));
vi.mock('./s3', () => ({
	get s3Enabled() {
		return storage.enabled;
	},
	getObject: vi.fn(),
	signedUrl: vi.fn(),
	deleteObjects: vi.fn(),
	deleteObject: storage.remove
}));

import { sql } from './db';
import {
	addAttachments,
	addComment,
	addLink,
	addRelation,
	createIssues,
	dashboard,
	deleteAttachment,
	deleteComment,
	deleteLink,
	getAttachment,
	getIssue,
	inboxCount,
	listApps,
	listAttachments,
	listEvents,
	listIssues,
	listLinks,
	listMilestones,
	listRelations,
	listSubtasks,
	listTodayIssues,
	setReminder,
	similarIssues,
	takeDueReminders,
	updateIssue
} from './repo';
import { addToToday, listTodayIds } from './today';
import { getMilestone } from './hill';
import { digestFor } from './notify';
import { TOOLS } from './mcp';
import { listTrash, pruneTrash, restoreIssues, trashIssues } from './trash';

describe.skipIf(!harness.enabled)('issue context and Trash against Postgres', () => {
	let userId: number;
	beforeAll(async () => {
		await sql`create schema ${sql(harness.namespace)}`;
		await sql.unsafe(schema).simple();
		await sql.unsafe(schema).simple(); // Startup migration remains idempotent.
	});
	afterAll(async () => {
		try {
			await sql`drop schema ${sql(harness.namespace)} cascade`;
		} finally {
			await sql.end({ timeout: 2 });
		}
	});
	beforeEach(async () => {
		storage.enabled = false;
		storage.remove.mockReset();
		await sql`truncate issues, apps, milestones, users, trash_object_cleanup restart identity cascade`;
		const [user] = await sql<{ id: number }[]>`insert into users (email, name, password_hash)
			values ('solo@example.test', 'Solo', 'unused') returning id`;
		userId = user.id;
	});
	async function create(
		title: string,
		options: { parentId?: number; apps?: string[]; milestone?: string } = {}
	) {
		return (await createIssues([{ title, apps: [], ...options }], userId)).ids[0];
	}
	const filters = (query = '') => parseFilters(new URLSearchParams(query));

	it('saves, searches and clears resume notes without changing the description', async () => {
		const id = await create('Investigate checkout');
		await updateIssue(
			id,
			{
				description: 'Original report',
				stopped: 'Cookie experiment\nKeep context',
				nextAction: 'Inspect callback headers'
			},
			userId
		);
		expect(await getIssue(id)).toMatchObject({
			description: 'Original report',
			stopped: 'Cookie experiment\nKeep context',
			nextAction: 'Inspect callback headers'
		});
		expect((await listIssues(filters('q=callback'))).issues.map((i) => i.id)).toEqual([id]);
		expect((await listEvents(id)).map((e) => e.field)).toContain('next action');
		for (const invalid of [null, 42, {}, 'x'.repeat(20001)]) {
			await expect(
				updateIssue(id, { stopped: invalid } as IssuePatch, userId)
			).rejects.toMatchObject({ status: 400 });
		}
		await updateIssue(id, { stopped: '', nextAction: '' }, userId);
		expect(await getIssue(id)).toMatchObject({
			stopped: '',
			nextAction: '',
			description: 'Original report'
		});
	});

	it('hides deleted context everywhere and restores attachments, history, links and blockers', async () => {
		const id = await create('Safari checkout crash', { apps: ['shop'], milestone: 'Launch' });
		const blocked = await create('Ship checkout');
		await updateIssue(id, { stopped: 'Reproduced', nextAction: 'Inspect cookies' }, userId);
		await addComment(id, 'Important finding', userId);
		await addAttachments(
			id,
			[{ filename: 'log.txt', mime: 'text/plain', size: 4, key: 'test/log' }],
			userId
		);
		const [file] = await listAttachments(id);
		await addLink(id, 'https://example.test/pr/1', 'PR', userId);
		await addRelation(id, 'blocks', blocked, userId);
		await addToToday(userId, id);
		await setReminder(id, new Date(Date.now() - 1000), userId);
		await trashIssues([id], userId);
		expect(await getIssue(id)).toBeNull();
		expect(await getAttachment(file.id)).toBeNull();
		expect((await listIssues(filters('status=all'))).issues.map((i) => i.id)).toEqual([blocked]);
		expect(await listTodayIds(userId)).toEqual([]);
		expect(await listTodayIssues(userId)).toEqual([]);
		expect(await takeDueReminders()).toEqual([]);
		expect(await listRelations(blocked)).toEqual([]);
		expect((await getIssue(blocked))?.isBlocked).toBe(false);
		expect(await similarIssues('Safari checkout crash')).toEqual([]);
		expect((await listApps())[0]).toMatchObject({ openCount: 0, totalCount: 0 });
		expect((await listMilestones())[0]).toMatchObject({ openCount: 0, totalCount: 0 });
		expect(await getMilestone((await listMilestones())[0].id)).toMatchObject({ totalCount: 0 });
		expect((await dashboard()).fires.open).toBe(1);
		expect(await inboxCount()).toBe(1);
		expect((await listTrash()).issues[0]).toMatchObject({
			id,
			stopped: 'Reproduced',
			nextAction: 'Inspect cookies'
		});
		await restoreIssues([id], userId);
		expect(await getIssue(id)).toMatchObject({
			stopped: 'Reproduced',
			nextAction: 'Inspect cookies',
			remindAt: null
		});
		expect(await getAttachment(file.id)).toMatchObject({ key: 'test/log' });
		expect(await listLinks(id)).toHaveLength(1);
		expect((await listEvents(id)).some((e) => e.body === 'Important finding')).toBe(true);
		expect((await getIssue(blocked))?.isBlocked).toBe(true);
		expect(await listTodayIds(userId)).toEqual([]);
	});

	it('restores only the children moved with their parent, independently of a bulk deletion', async () => {
		const parent = await create('Parent');
		const child = await create('Active child', { parentId: parent });
		const separate = await create('Previously deleted child', { parentId: parent });
		const unrelated = await create('Unrelated');
		await trashIssues([separate], userId);
		await trashIssues([parent, child, unrelated], userId);
		await expect(restoreIssues([separate], userId)).rejects.toMatchObject({ status: 409 });
		expect(await restoreIssues([parent], userId)).toEqual(expect.arrayContaining([parent, child]));
		expect(await listSubtasks(parent)).toHaveLength(1);
		expect(await getIssue(separate)).toBeNull();
		expect(await getIssue(unrelated)).toBeNull();
		await restoreIssues([separate], userId);
		expect(await listSubtasks(parent)).toHaveLength(2);
	});

	it('rejects edits and new related records while an issue is in Trash', async () => {
		const id = await create('Deleted issue');
		await addComment(id, 'Preserve me', userId);
		const [comment] = await listEvents(id);
		await addLink(id, 'https://example.test', null, userId);
		const [link] = await listLinks(id);
		await addAttachments(
			id,
			[{ filename: 'log', mime: 'text/plain', size: 1, key: 'test/log' }],
			userId
		);
		const [file] = await listAttachments(id);
		await trashIssues([id], userId);
		expect(await updateIssue(id, { nextAction: 'Overwrite' }, userId)).toBeNull();
		await expect(addComment(id, 'Lost', userId)).rejects.toMatchObject({ status: 404 });
		await expect(addLink(id, 'https://example.test/new', null, userId)).rejects.toMatchObject({
			status: 404
		});
		await expect(deleteLink(id, link.id, userId)).rejects.toMatchObject({ status: 404 });
		await expect(deleteAttachment(id, file.id, userId)).rejects.toMatchObject({ status: 404 });
		await expect(
			addAttachments(
				id,
				[{ filename: 'new', mime: 'text/plain', size: 1, key: 'test/new' }],
				userId
			)
		).rejects.toMatchObject({ status: 404 });
		await expect(addToToday(userId, id)).rejects.toMatchObject({ status: 404 });
		await expect(create('New child', { parentId: id })).rejects.toMatchObject({ status: 400 });
		await expect(
			deleteComment(id, comment.id, {
				id: userId,
				role: 'admin',
				name: 'Solo',
				email: 'solo@example.test'
			})
		).rejects.toMatchObject({ status: 404 });
		await restoreIssues([id], userId);
		expect(await listLinks(id)).toHaveLength(1);
		expect(await listAttachments(id)).toHaveLength(1);
		expect((await listEvents(id)).some((e) => e.body === 'Preserve me')).toBe(true);
	});

	it('does not extend retention on repeated deletes and restores a batch atomically', async () => {
		const id = await create('Keep original deadline');
		await trashIssues([id], userId);
		await sql`update issues set deleted_at = now() - interval '3 days' where id = ${id}`;
		const [before] = await sql`select deleted_at from issues where id = ${id}`;
		await trashIssues([id], userId);
		const [after] = await sql`select deleted_at from issues where id = ${id}`;
		expect(after.deletedAt).toEqual(before.deletedAt);
		await expect(restoreIssues([id, 999999], userId)).rejects.toMatchObject({ status: 404 });
		expect(await getIssue(id)).toBeNull();
	});

	it('expires old issues, queues file cleanup, and preserves a younger deleted child', async () => {
		const parent = await create('Expired parent');
		const child = await create('Separately deleted child', { parentId: parent });
		await addAttachments(
			parent,
			[{ filename: 'log', mime: 'text/plain', size: 1, key: 'test/expired' }],
			userId
		);
		await trashIssues([child], userId);
		await trashIssues([parent], userId);
		await sql`update issues set deleted_at = now() - interval '31 days' where id = ${parent}`;
		await expect(restoreIssues([parent], userId)).rejects.toMatchObject({ status: 404 });
		expect((await listTrash()).issues.map((i) => i.id)).toEqual([child]);
		await pruneTrash();
		expect(await sql`select id from issues where id = ${parent}`).toHaveLength(0);
		expect(await sql`select key from trash_object_cleanup`).toEqual([{ key: 'test/expired' }]);
		await restoreIssues([child], userId);
		expect(await getIssue(child)).toMatchObject({ parentId: null });
	});

	it('can restore a younger child immediately after its parent expires, before cleanup', async () => {
		const parent = await create('Parent');
		const child = await create('Child', { parentId: parent });
		await trashIssues([child], userId);
		await trashIssues([parent], userId);
		await sql`update issues set deleted_at = now() - interval '31 days' where id = ${parent}`;
		await restoreIssues([child], userId);
		expect(await getIssue(child)).toMatchObject({ parentId: null });
	});

	it('preserves a future reminder and repeat schedule without spawning on trash or restore', async () => {
		const id = await create('Routine');
		await updateIssue(id, { repeat: 'weekly' }, userId);
		const future = new Date(Date.now() + 86400000);
		await setReminder(id, future, userId);
		await trashIssues([id], userId);
		await restoreIssues([id], userId);
		expect(await getIssue(id)).toMatchObject({ repeat: 'weekly', remindAt: future });
		expect((await listIssues(filters('status=all'))).total).toBe(1);
	});
	it('excludes trashed issues from daily summaries and supports resume and restore through MCP', async () => {
		const id = await create('MCP context');
		await updateIssue(
			id,
			{
				dueDate: new Date().toISOString().slice(0, 10),
				stopped: 'Found the callback',
				nextAction: 'Inspect cookies'
			},
			userId
		);
		const ctx = {
			user: { id: userId, name: 'Solo', email: 'solo@example.test', role: 'admin' as const },
			origin: 'https://example.test'
		};
		const tool = (name: string) => TOOLS.find((t) => t.name === name)!;
		const content = JSON.stringify(await tool('get_issue').run({ id, attachments: false }, ctx));
		expect(content).toContain('Found the callback');
		expect(content).toContain('Inspect cookies');
		await tool('update_issue').run({ id, stopped: '', next_action: 'Verify Safari' }, ctx);
		expect(await getIssue(id)).toMatchObject({ stopped: '', nextAction: 'Verify Safari' });
		await trashIssues([id], userId);
		expect(await digestFor(new Date().toISOString().slice(0, 10))).toBeNull();
		expect(JSON.stringify(await tool('list_trash').run({}, ctx))).toContain('MCP context');
		await tool('restore_issue').run({ id }, ctx);
		expect(await getIssue(id)).toMatchObject({ nextAction: 'Verify Safari' });
	});
	it('retries failed storage cleanup after an issue has expired', async () => {
		const id = await create('Old attachment');
		await addAttachments(
			id,
			[{ filename: 'log', mime: 'text/plain', size: 1, key: 'test/retry' }],
			userId
		);
		await trashIssues([id], userId);
		await sql`update issues set deleted_at = now() - interval '31 days' where id = ${id}`;
		storage.enabled = true;
		storage.remove.mockRejectedValueOnce(new Error('Storage offline'));
		await expect(pruneTrash()).rejects.toThrow('Storage offline');
		expect(await sql`select id from issues where id = ${id}`).toHaveLength(0);
		expect(await sql`select key from trash_object_cleanup`).toEqual([{ key: 'test/retry' }]);
		storage.remove.mockResolvedValue(undefined);
		await pruneTrash();
		expect(storage.remove).toHaveBeenCalledTimes(2);
		expect(await sql`select key from trash_object_cleanup`).toHaveLength(0);
	});
});
