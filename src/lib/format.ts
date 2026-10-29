const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto', style: 'narrow' });

export function ago(d: Date | string) {
	const s = (new Date(d).getTime() - Date.now()) / 1000;
	const abs = Math.abs(s);
	if (abs < 60) return 'now';
	if (abs < 3600) return rtf.format(Math.round(s / 60), 'minute');
	if (abs < 86400) return rtf.format(Math.round(s / 3600), 'hour');
	if (abs < 86400 * 30) return rtf.format(Math.round(s / 86400), 'day');
	if (abs < 86400 * 365) return rtf.format(Math.round(s / (86400 * 30)), 'month');
	return rtf.format(Math.round(s / (86400 * 365)), 'year');
}

export function fullDate(d: Date | string) {
	return new Date(d).toLocaleString();
}

export const TYPE_CLASS: Record<string, string> = {
	bug: 'text-red-600 dark:text-red-400',
	feature: 'text-violet-600 dark:text-violet-400',
	task: 'text-zinc-500',
	improvement: 'text-sky-600 dark:text-sky-400'
};

export const PRIORITY_CLASS = [
	'text-red-600 font-semibold dark:text-red-400',
	'text-orange-600 dark:text-orange-400',
	'text-zinc-500',
	'text-zinc-400 dark:text-zinc-600'
];

export function fileSize(bytes: number) {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
	return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export const SEVERITY_CLASS: Record<string, string> = {
	critical: 'text-red-600 font-semibold dark:text-red-400',
	major: 'text-orange-600 dark:text-orange-400',
	minor: 'text-zinc-500',
	trivial: 'text-zinc-400 dark:text-zinc-600'
};

export const ENV_CLASS: Record<string, string> = {
	production: 'text-red-600 dark:text-red-400',
	staging: 'text-amber-600 dark:text-amber-400',
	local: 'text-zinc-400'
};
