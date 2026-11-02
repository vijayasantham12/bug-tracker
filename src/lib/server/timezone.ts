import { sql } from './db';

/**
 * Browsers (ICU) still report some legacy IANA names, such as Asia/Calcutta, but Postgres
 * images built against recent tzdata leave those "backward" links out. Map the common ones
 * to their canonical names.
 */
const LEGACY: Record<string, string> = {
	'Asia/Calcutta': 'Asia/Kolkata',
	'Asia/Saigon': 'Asia/Ho_Chi_Minh',
	'Asia/Katmandu': 'Asia/Kathmandu',
	'Asia/Rangoon': 'Asia/Yangon',
	'Asia/Dacca': 'Asia/Dhaka',
	'Asia/Thimbu': 'Asia/Thimphu',
	'Asia/Ulan_Bator': 'Asia/Ulaanbaatar',
	'Asia/Macao': 'Asia/Macau',
	'Europe/Kiev': 'Europe/Kyiv',
	'Europe/Uzhgorod': 'Europe/Kyiv',
	'Europe/Zaporozhye': 'Europe/Kyiv',
	'America/Buenos_Aires': 'America/Argentina/Buenos_Aires',
	'America/Indianapolis': 'America/Indiana/Indianapolis',
	'America/Louisville': 'America/Kentucky/Louisville',
	'America/Godthab': 'America/Nuuk',
	'Atlantic/Faeroe': 'Atlantic/Faroe',
	'Pacific/Truk': 'Pacific/Chuuk',
	'Pacific/Ponape': 'Pacific/Pohnpei',
	'Pacific/Enderbury': 'Pacific/Kanton'
};

let known: Promise<Set<string>> | undefined;

/** Returns a zone name the database accepts, or null if there is no equivalent. */
export async function pgTimezone(tz: string | null | undefined): Promise<string | null> {
	if (!tz) return null;
	known ??= sql<{ name: string }[]>`select name from pg_timezone_names`.then(
		(rows) => new Set(rows.map((r) => r.name)),
		(err) => {
			known = undefined;
			throw err;
		}
	);
	const names = await known;
	if (names.has(tz)) return tz;
	const alias = LEGACY[tz];
	return alias && names.has(alias) ? alias : null;
}
