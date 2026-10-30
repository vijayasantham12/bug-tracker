<script lang="ts">
	import { untrack } from 'svelte';
	import { api } from '#lib/api.ts';
	import { guardUnsaved } from '#lib/unsaved.ts';
	import { notify } from '#lib/toast.svelte.ts';
	import type { Issue } from '#lib/types.ts';

	let { issue, open = $bindable(false) }: { issue: Issue; open?: boolean } = $props();
	let stopped = $state(untrack(() => issue.stopped));
	let nextAction = $state(untrack(() => issue.nextAction));
	let previous = untrack(() => ({ stopped: issue.stopped, nextAction: issue.nextAction }));
	let saving = $state(false);
	const dirty = $derived(stopped !== issue.stopped || nextAction !== issue.nextAction);
	const hasNote = $derived(!!(issue.stopped.trim() || issue.nextAction.trim()));

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
		} else if (event.key === 'Escape') {
			event.preventDefault();
			if (!dirty || confirm('Discard changes to the resume note?')) cancel();
		}
	}
	// Grow textareas with their content (capped by max-h, then they scroll).
	function autosize(node: HTMLTextAreaElement) {
		const fit = () => {
			node.style.height = 'auto';
			node.style.height = `${node.scrollHeight + 2}px`;
		};
		queueMicrotask(fit);
		node.addEventListener('input', fit);
		return () => node.removeEventListener('input', fit);
	}
	function focusEnd(node: HTMLTextAreaElement) {
		node.focus();
		node.setSelectionRange(node.value.length, node.value.length);
	}
	function cancel() {
		stopped = issue.stopped;
		nextAction = issue.nextAction;
		open = false;
	}
	async function save() {
		if (saving || !dirty) return;
		saving = true;
		try {
			await api('PATCH', `/api/issues/${issue.id}`, { stopped, nextAction });
			notify('Resume note saved');
			open = false;
		} catch {
			// Keep the draft; the API helper displays the failure.
		} finally {
			saving = false;
		}
	}
</script>

{#if open}
	<form
		class="mt-3 rounded border border-amber-200 bg-amber-50/30 p-3 dark:border-amber-900/60 dark:bg-amber-950/10"
		aria-label="Resume work"
		onsubmit={(event) => {
			event.preventDefault();
			void save();
		}}
	>
		<h2 class="mb-2 text-xs font-medium tracking-wide text-amber-700 uppercase dark:text-amber-400">
			Resume note
		</h2>
		<label class="block text-xs font-medium text-zinc-500" for="resume-stopped">
			Where I stopped
		</label>
		<textarea
			id="resume-stopped"
			{@attach autosize}
			{@attach focusEnd}
			class="input mt-1 max-h-72 min-h-16 w-full resize-none text-sm leading-relaxed"
			rows="3"
			maxlength="20000"
			disabled={saving}
			onkeydown={onKey}
			bind:value={stopped}
			placeholder="What did you find? Where did you leave off?"></textarea>
		<label class="mt-3 block text-xs font-medium text-zinc-500" for="resume-next">
			Next action
		</label>
		<textarea
			id="resume-next"
			{@attach autosize}
			class="input mt-1 max-h-72 min-h-10 w-full resize-none text-sm leading-relaxed"
			rows="2"
			maxlength="20000"
			disabled={saving}
			onkeydown={onKey}
			bind:value={nextAction}
			placeholder="The first concrete step when you return…"></textarea>
		<div class="mt-2 flex items-center gap-2">
			<p class="mr-auto text-xs text-zinc-500" role="status">
				{saving ? 'Saving…' : dirty ? 'Unsaved · Ctrl+Enter to save · Esc cancels' : 'Esc to close'}
			</p>
			<button
				type="button"
				class="text-xs text-zinc-500 hover:underline"
				disabled={saving}
				onclick={cancel}>Cancel</button
			>
			<button type="submit" class="btn py-1" disabled={saving || !dirty}>Save note</button>
		</div>
	</form>
{:else if hasNote}
	<button
		type="button"
		class="mt-3 block w-full rounded border-l-2 border-amber-400 bg-amber-50/40 px-2.5 py-1.5 text-left text-xs hover:bg-amber-50 dark:border-amber-700 dark:bg-amber-950/10 dark:hover:bg-amber-950/30"
		title="Edit resume note"
		onclick={() => (open = true)}
	>
		{#if issue.stopped.trim()}
			<p class="font-medium text-amber-700 dark:text-amber-400">Where I stopped</p>
			<p class="line-clamp-3 break-words text-zinc-600 dark:text-zinc-400">
				<span class="whitespace-pre-line">{issue.stopped.trim()}</span>
			</p>
		{/if}
		{#if issue.nextAction.trim()}
			<p class="mt-1.5 font-medium text-amber-700 dark:text-amber-400">Next action</p>
			<p class="line-clamp-3 break-words text-zinc-600 dark:text-zinc-400">
				<span class="whitespace-pre-line">{issue.nextAction.trim()}</span>
			</p>
		{/if}
	</button>
{/if}
