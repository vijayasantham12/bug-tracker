import { spawn } from 'node:child_process';
import { BACKUP_KEEP_DAYS, DATABASE_URL, PG_DUMP, S3_PREFIX } from '$app/env/private';
import { sql } from './db';
import { deleteObjects, listKeys, putObject, s3Enabled } from './s3';

/**
 * Nightly `pg_dump --format=custom` into the attachments bucket, one file per UTC day,
 * older ones pruned after BACKUP_KEEP_DAYS. Restore with:
 *   pg_restore --clean --if-exists --no-owner -d "$DATABASE_URL" 2026-10-29.dump
 */

const PREFIX = `${S3_PREFIX}backups/`;

export const backupsEnabled = s3Enabled && BACKUP_KEEP_DAYS > 0;

export interface BackupInfo {
	at: string;
	key: string;
	size: number;
}

function dump(): Promise<Buffer> {
	const [cmd, ...args] = PG_DUMP.trim().split(/\s+/);
	return new Promise((resolve, reject) => {
		const child = spawn(
			cmd,
			[...args, '--format=custom', '--no-owner', `--dbname=${DATABASE_URL}`],
			{
				stdio: ['ignore', 'pipe', 'pipe']
			}
		);
		const out: Buffer[] = [];
		let err = '';
		child.stdout.on('data', (b: Buffer) => out.push(b));
		child.stderr.on('data', (b: Buffer) => (err += b));
		child.on('error', (e) => reject(new Error(`Could not run ${cmd}: ${e.message}`)));
		child.on('close', (code) =>
			code === 0
				? resolve(Buffer.concat(out))
				: reject(new Error(`${cmd} exited with ${code}: ${err.trim().slice(0, 300)}`))
		);
	});
}

export async function runBackup(): Promise<BackupInfo> {
	if (!s3Enabled) throw new Error('Backups need S3 (set S3_BUCKET and its credentials)');
	const data = await dump();
	const at = new Date().toISOString();
	const key = `${PREFIX}${at.slice(0, 10)}.dump`;
	await putObject(key, new Uint8Array(data), 'application/octet-stream');
	const info: BackupInfo = { at, key, size: data.byteLength };
	await sql`
		insert into app_settings (key, value) values ('last_backup', ${JSON.stringify(info)})
		on conflict (key) do update set value = excluded.value
	`;
	await sql`delete from app_settings where key = 'backup_error'`;
	await pruneBackups();
	return info;
}

async function pruneBackups() {
	const cutoff = new Date(Date.now() - BACKUP_KEEP_DAYS * 86_400_000).toISOString().slice(0, 10);
	const old = (await listKeys(PREFIX)).filter((k) => {
		const day = /(\d{4}-\d{2}-\d{2})\.dump$/.exec(k)?.[1];
		return day && day < cutoff;
	});
	await deleteObjects(old);
}

/** The last successful backup, and the error of a later failed one (shown in Settings). */
export async function backupStatus() {
	const rows = await sql<{ key: string; value: string }[]>`
		select key, value from app_settings where key in ('last_backup', 'backup_error')
	`;
	const get = (k: string) => rows.find((r) => r.key === k)?.value;
	const last = get('last_backup');
	return {
		enabled: backupsEnabled,
		last: last ? (JSON.parse(last) as BackupInfo) : null,
		error: get('backup_error') ?? null
	};
}

/**
 * Called every minute: the first tick of each UTC day claims and runs that day's backup.
 * A failure isn't retried until the next day (so a missing pg_dump doesn't fail every minute);
 * Settings shows it, and "Back up now" retries.
 */
export async function backupIfDue() {
	if (!backupsEnabled) return;
	const today = new Date().toISOString().slice(0, 10);
	const claimed = await sql`
		insert into app_settings (key, value) values ('backup_on', ${today})
		on conflict (key) do update set value = excluded.value where app_settings.value < excluded.value
		returning key
	`;
	if (!claimed.length) return;
	try {
		await runBackup();
	} catch (e) {
		const message = `${new Date().toISOString()}: ${(e as Error).message}`;
		await sql`
			insert into app_settings (key, value) values ('backup_error', ${message})
			on conflict (key) do update set value = excluded.value
		`;
		throw e;
	}
}
