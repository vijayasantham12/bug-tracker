<script lang="ts">
	import { api } from '#lib/api.ts';

	let {
		issueId,
		selected,
		compact = false,
		shortcut
	}: { issueId: number; selected: boolean; compact?: boolean; shortcut?: string } = $props();
	let busy = $state(false);

	async function toggle() {
		if (busy) return;
		busy = true;
		try {
			await api(selected ? 'DELETE' : 'POST', '/api/today', { issueId });
		} catch {
			// The API helper displays the error; leave the selection unchanged.
		} finally {
			busy = false;
		}
	}
</script>

<button
	type="button"
	class="shrink-0 rounded px-1.5 py-0.5 text-xs whitespace-nowrap disabled:opacity-40 {selected
		? 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400'
		: 'text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200'}"
	aria-label="{selected ? 'Remove' : 'Add'} #{issueId} {selected ? 'from' : 'to'} Today"
	aria-pressed={selected}
	title="{selected ? 'Remove from Today' : 'Add to Today'}{shortcut ? ` (${shortcut})` : ''}"
	data-key={shortcut}
	aria-keyshortcuts={shortcut}
	disabled={busy}
	onclick={toggle}
>
	{selected ? '★' : '☆'}{#if !compact}
		{selected ? 'Today' : 'Add to Today'}{/if}
</button>
