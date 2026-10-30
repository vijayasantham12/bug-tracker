<script lang="ts">
	import { untrack } from 'svelte';
	import { api } from '#lib/api.ts';
	import { guardUnsaved } from '#lib/unsaved.ts';
	import { notify } from '#lib/toast.svelte.ts';
	import type { Issue } from '#lib/types.ts';

	let { issue }: { issue: Issue } = $props();
	let stopped = $state(untrack(() => issue.stopped));
	let nextAction = $state(untrack(() => issue.nextAction));
	let previous = untrack(() => ({ stopped: issue.stopped, nextAction: issue.nextAction }));
	let saving = $state(false);
	const dirty = $derived(stopped !== issue.stopped || nextAction !== issue.nextAction);

	// Accept refreshed notes without discarding a draft during unrelated issue edits.
	$effect(() => {
		const incoming = { stopped: issue.stopped, nextAction: issue.nextAction };
		untrack(() => {
			if (stopped === previous.stopped) stopped = incoming.stopped;
			if (nextAction === previous.nextAction) nextAction = incoming.nextAction;
			previous = incoming;
		});
	});

	guardUnsaved(() => dirty || saving);
	function onKey(event: KeyboardEvent) {
		if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
			event.preventDefault();
			void save();
		}
	}
	async function save() {
		if (saving || !dirty) return;
		saving = true;
		try {
			await api('PATCH', `/api/issues/${issue.id}`, { stopped, nextAction });
			notify('Resume note saved');
		} catch {
			// Keep the draft; the API helper displays the failure.
		} finally {
			saving = false;
		}
	}
</script>

<form
	class="mt-4 rounded border border-amber-200 bg-amber-50/30 p-3 dark:border-amber-900/60 dark:bg-amber-950/10"
	aria-label="Resume work"
	onsubmit={(event) => {
		event.preventDefault();
		void save();
	}}
>
	<h2 class="mb-2 text-xs font-medium tracking-wide text-amber-700 uppercase dark:text-amber-400">
		Resume work
	</h2>
	<label class="block text-xs text-zinc-500" for="resume-stopped">Where I stopped</label>
	<textarea
		id="resume-stopped"
		class="input mt-1 w-full resize-y"
		rows="3"
		maxlength="20000"
		disabled={saving}
		onkeydown={onKey}
		bind:value={stopped}
		placeholder="What did you find? Where did you leave off?"></textarea>
	<label class="mt-2 block text-xs text-zinc-500" for="resume-next">Next action</label>
	<textarea
		id="resume-next"
		class="input mt-1 w-full resize-y"
		rows="2"
		maxlength="20000"
		disabled={saving}
		onkeydown={onKey}
		bind:value={nextAction}
		placeholder="The first concrete step when you return…"></textarea>
	<div class="mt-2 flex items-center gap-2">
		<p class="mr-auto text-xs text-zinc-500" role="status">
			{saving ? 'Saving…' : dirty ? 'Unsaved changes · Ctrl+Enter to save' : 'Saved'}
		</p>
		{#if dirty}<button
				type="button"
				class="text-xs text-zinc-500 hover:underline"
				disabled={saving}
				onclick={() => {
					stopped = issue.stopped;
					nextAction = issue.nextAction;
				}}>Cancel</button
			>{/if}
		<button type="submit" class="btn py-1" disabled={saving || !dirty}>Save note</button>
	</div>
</form>
