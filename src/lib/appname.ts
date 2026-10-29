/** App names: lowercase, no spaces, so `@name` in quick add and `?app=a,b` filters always work. */
export const APP_NAME_MAX = 40;

/**
 * "Admin Panel" → "admin-panel". Returns '' when nothing usable is left.
 * With `typing`, a trailing separator is kept so a space typed mid-name becomes a visible `-`.
 */
export function toAppName(input: string, typing = false) {
	const name = input
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/g, '-')
		.replace(/-{2,}/g, '-')
		.replace(/^[._-]+/, '')
		.slice(0, APP_NAME_MAX);
	return typing ? name : name.replace(/[._-]+$/, '');
}
