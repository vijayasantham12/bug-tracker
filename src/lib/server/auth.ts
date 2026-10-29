import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { sql } from './db';
import type { Role, User } from '#lib/types.ts';

const scryptAsync = promisify(scrypt) as (
	pw: string,
	salt: Buffer,
	len: number,
	opts: object
) => Promise<Buffer>;
const SCRYPT = { N: 16384, r: 8, p: 1 };

export const SESSION_COOKIE = 'session';
const SESSION_DAYS = 30;
const INVITE_DAYS = 7;
export const MIN_PASSWORD = 8;

// ---------- passwords ----------

export async function hashPassword(password: string) {
	const salt = randomBytes(16);
	const hash = await scryptAsync(password, salt, 64, SCRYPT);
	return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string) {
	const [algo, N, r, p, salt, hash] = stored.split('$');
	if (algo !== 'scrypt') return false;
	const expected = Buffer.from(hash, 'base64');
	const actual = await scryptAsync(password, Buffer.from(salt, 'base64'), expected.length, {
		N: Number(N),
		r: Number(r),
		p: Number(p)
	});
	return timingSafeEqual(actual, expected);
}

// used when the email is unknown so login timing doesn't reveal which emails exist
const DUMMY_HASH = hashPassword(randomBytes(16).toString('hex'));

// ---------- tokens & sessions ----------

const newToken = () => randomBytes(32).toString('base64url');
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export async function createSession(userId: number) {
	const token = newToken();
	const expires = new Date(Date.now() + SESSION_DAYS * 86400_000);
	await sql`insert into sessions (id, user_id, expires_at) values (${sha256(token)}, ${userId}, ${expires})`;
	return { token, expires };
}

/** Returns the user and, when the session was extended, its new expiry. */
export async function validateSession(token: string) {
	const id = sha256(token);
	const [row] = await sql<(User & { expiresAt: Date })[]>`
		select u.id, u.email, u.name, u.role, s.expires_at
		from sessions s join users u on u.id = s.user_id
		where s.id = ${id} and s.expires_at > now()
	`;
	if (!row) return null;
	const { expiresAt, ...user } = row;
	// sliding expiry: extend once less than half the lifetime is left
	if (expiresAt.getTime() - Date.now() < (SESSION_DAYS / 2) * 86400_000) {
		const expires = new Date(Date.now() + SESSION_DAYS * 86400_000);
		await sql`update sessions set expires_at = ${expires} where id = ${id}`;
		return { user, expires };
	}
	return { user, expires: null };
}

export async function deleteSession(token: string) {
	await sql`delete from sessions where id = ${sha256(token)}`;
}

// ---------- users ----------

export async function userCount() {
	const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from users`;
	return n;
}

/** Creates the first admin; returns null if any user already exists (setup is one-shot). */
export async function createFirstAdmin(email: string, name: string, password: string) {
	const hash = await hashPassword(password);
	const [row] = await sql<{ id: number }[]>`
		insert into users (email, name, password_hash, role)
		select ${email}, ${name}, ${hash}, 'admin'
		where not exists (select 1 from users)
		returning id
	`;
	return row?.id ?? null;
}

export async function login(email: string, password: string) {
	const [row] = await sql<{ id: number; passwordHash: string }[]>`
		select id, password_hash from users where lower(email) = lower(${email})
	`;
	const ok = await verifyPassword(password, row?.passwordHash ?? (await DUMMY_HASH));
	return row && ok ? row.id : null;
}

export function listUsers() {
	return sql<(User & { createdAt: Date })[]>`
		select id, email, name, role, created_at from users order by created_at
	`;
}

export async function setRole(id: number, role: Role) {
	await sql`update users set role = ${role} where id = ${id}`;
}

export async function deleteUser(id: number) {
	await sql`delete from users where id = ${id}`;
}

export async function changePassword(userId: number, current: string, next: string) {
	const [row] = await sql<
		{ passwordHash: string }[]
	>`select password_hash from users where id = ${userId}`;
	if (!row || !(await verifyPassword(current, row.passwordHash))) return false;
	await sql`update users set password_hash = ${await hashPassword(next)} where id = ${userId}`;
	return true;
}

// ---------- invites ----------

export async function createInvite(createdBy: number, role: Role, email: string | null) {
	const token = newToken();
	await sql`
		insert into invites (token_hash, email, role, created_by, expires_at)
		values (${sha256(token)}, ${email}, ${role}, ${createdBy}, now() + make_interval(days => ${INVITE_DAYS}))
	`;
	return token;
}

export function listInvites() {
	return sql<{ id: number; email: string | null; role: Role; createdAt: Date; expiresAt: Date }[]>`
		select id, email, role, created_at, expires_at from invites
		where used_at is null and expires_at > now() order by created_at desc
	`;
}

export async function deleteInvite(id: number) {
	await sql`delete from invites where id = ${id}`;
}

export async function getInvite(token: string) {
	const [row] = await sql<{ id: number; email: string | null; role: Role }[]>`
		select id, email, role from invites
		where token_hash = ${sha256(token)} and used_at is null and expires_at > now()
	`;
	return row ?? null;
}

/** Marks the invite used and creates the user atomically. Returns null if the invite is gone or the email is taken. */
export async function acceptInvite(token: string, email: string, name: string, password: string) {
	const hash = await hashPassword(password);
	return sql.begin(async (tx) => {
		const [invite] = await tx<{ role: Role }[]>`
			update invites set used_at = now()
			where token_hash = ${sha256(token)} and used_at is null and expires_at > now()
			returning role
		`;
		if (!invite) return null;
		const [taken] = await tx`select 1 from users where lower(email) = lower(${email})`;
		if (taken) return null;
		const [user] = await tx<{ id: number }[]>`
			insert into users (email, name, password_hash, role)
			values (${email}, ${name}, ${hash}, ${invite.role}) returning id
		`;
		return user.id;
	});
}

// ---------- login throttling (in-memory, per process) ----------

const failures = new Map<string, { count: number; until: number }>();
const MAX_FAILURES = 10;
const WINDOW_MS = 15 * 60_000;

export function isThrottled(key: string) {
	const f = failures.get(key);
	if (!f || f.until < Date.now()) return false;
	return f.count >= MAX_FAILURES;
}

export function recordFailure(key: string) {
	const f = failures.get(key);
	if (!f || f.until < Date.now()) failures.set(key, { count: 1, until: Date.now() + WINDOW_MS });
	else f.count++;
}

export function clearFailures(key: string) {
	failures.delete(key);
}

// ---------- API tokens ----------

export const API_TOKEN_PREFIX = 'bt_';

export async function createApiToken(userId: number, name: string) {
	const token = API_TOKEN_PREFIX + newToken();
	await sql`
		insert into api_tokens (user_id, name, token_hash) values (${userId}, ${name}, ${sha256(token)})
	`;
	return token;
}

export function listApiTokens(userId: number) {
	return sql<{ id: number; name: string; createdAt: Date; lastUsedAt: Date | null }[]>`
		select id, name, created_at, last_used_at from api_tokens
		where user_id = ${userId} order by created_at desc
	`;
}

export async function deleteApiToken(userId: number, id: number) {
	await sql`delete from api_tokens where id = ${id} and user_id = ${userId}`;
}

export async function validateApiToken(token: string): Promise<User | null> {
	if (!token.startsWith(API_TOKEN_PREFIX)) return null;
	const [row] = await sql<User[]>`
		update api_tokens t set last_used_at = now()
		from users u
		where t.token_hash = ${sha256(token)} and u.id = t.user_id
		returning u.id, u.email, u.name, u.role
	`;
	return row ?? null;
}
