/** Grouping and export for the Done log. Days are local 'YYYY-MM-DD' strings from the server. */

export interface DoneItem {
	id: number;
	title: string;
	type: string;
	appName: string;
	fixedIn: string | null;
	statusId: number;
	closedDay: string;
}

export interface DoneDay<T> {
	day: string;
	issues: T[];
}
export interface DoneWeek<T> {
	/** Monday of the week */
	start: string;
	label: string;
	count: number;
	days: DoneDay<T>[];
}

const utc = (day: string) => new Date(`${day}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);

export function mondayOf(day: string) {
	const d = utc(day);
	d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
	return iso(d);
}

const dayFmt = new Intl.DateTimeFormat('en', {
	weekday: 'short',
	month: 'short',
	day: 'numeric',
	timeZone: 'UTC'
});
const weekFmt = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const yearFmt = new Intl.DateTimeFormat('en', {
	month: 'short',
	day: 'numeric',
	year: 'numeric',
	timeZone: 'UTC'
});

export function dayLabel(day: string, today: string) {
	if (day === today) return 'Today';
	const yesterday = utc(today);
	yesterday.setUTCDate(yesterday.getUTCDate() - 1);
	if (day === iso(yesterday)) return 'Yesterday';
	return dayFmt.format(utc(day));
}

export function weekLabel(start: string, today: string) {
	const current = mondayOf(today);
	if (start === current) return 'This week';
	const last = utc(current);
	last.setUTCDate(last.getUTCDate() - 7);
	if (start === iso(last)) return 'Last week';
	const fmt = start.slice(0, 4) === today.slice(0, 4) ? weekFmt : yearFmt;
	return `Week of ${fmt.format(utc(start))}`;
}

/** Expects issues newest first; keeps that order within each day. */
export function groupDone<T extends DoneItem>(issues: T[], today: string): DoneWeek<T>[] {
	const weeks: DoneWeek<T>[] = [];
	for (const issue of issues) {
		const start = mondayOf(issue.closedDay);
		let week = weeks.at(-1);
		if (week?.start !== start) {
			week = { start, label: weekLabel(start, today), count: 0, days: [] };
			weeks.push(week);
		}
		let day = week.days.at(-1);
		if (day?.day !== issue.closedDay) {
			day = { day: issue.closedDay, issues: [] };
			week.days.push(day);
		}
		day.issues.push(issue);
		week.count++;
	}
	return weeks;
}

const SECTIONS: [string, string][] = [
	['feature', 'Features'],
	['improvement', 'Improvements'],
	['bug', 'Fixes'],
	['task', 'Tasks']
];

/** Release-notes style Markdown for one week; issues in a non-shipping status are left out. */
export function weekMarkdown<T extends DoneItem>(
	week: DoneWeek<T>,
	shipped: (issue: T) => boolean
) {
	const all = week.days.flatMap((d) => d.issues).filter(shipped);
	const multiApp = new Set(all.map((i) => i.appName)).size > 1;
	const lines = [`## ${week.label} (${weekFmt.format(utc(week.start))})`];
	for (const [type, heading] of SECTIONS) {
		const items = all.filter((i) => i.type === type);
		if (!items.length) continue;
		lines.push('', `### ${heading}`);
		for (const i of items) {
			const app = multiApp ? `**${i.appName}**: ` : '';
			const version = i.fixedIn ? ` (${i.fixedIn})` : '';
			lines.push(`- ${app}${i.title} #${i.id}${version}`);
		}
	}
	return lines.join('\n');
}
