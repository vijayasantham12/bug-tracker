/** Things shared to the installed app from the OS share sheet (manifest `share_target`). */

/** Cache the service worker stashes a share in until /share reads it. */
export const SHARE_CACHE = 'bugs-share';
export const SHARE_META = '/share/meta';

export interface SharedMeta {
	title: string;
	text: string;
	url: string;
	files: { key: string; name: string; type: string }[];
}

/** First line (or the page title / URL) becomes the issue title, everything else the description. */
export function shareToIssue(s: Pick<SharedMeta, 'title' | 'text' | 'url'>) {
	const text = s.text.trim();
	const url = s.url.trim();
	const [firstLine = '', ...rest] = text.split(/\r?\n/);
	const title = (s.title.trim() || firstLine.trim() || url).slice(0, 200);
	const repeatUrl = url && !text.includes(url) && title !== url;
	const body = [s.title.trim() ? text : rest.join('\n').trim(), repeatUrl ? url : '']
		.filter(Boolean)
		.join('\n\n');
	return { title, description: body };
}
