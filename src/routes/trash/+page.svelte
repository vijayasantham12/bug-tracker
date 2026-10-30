<script lang="ts">
	import { api } from '#lib/api.ts';
	import { ago, fullDate } from '#lib/format.ts';
	import { notify } from '#lib/toast.svelte.ts';
	import Markdown from '#lib/components/Markdown.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	let busy = $state(false);
	async function restore(id: number) {
		if (busy) return;
		busy = true;
		try {
			const { ids } = await api<{ ids: number[] }>('POST', '/api/trash', { ids: [id] });
			notify(
				ids.length > 1 ? `Restored #${id} and ${ids.length - 1} subtask(s)` : `Restored #${id}`
			);
		} catch {
			// The API helper shows the error and leaves the issue available to retry.
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head><title>Trash · Bugs</title></svelte:head>

<div class="mb-4">
	<h1 class="text-lg font-semibold">
		Trash <span class="text-sm font-normal text-zinc-500">· {data.total}</span>
	</h1>
	<p class="mt-1 text-sm text-zinc-500">
		Restore issues within {data.retentionDays} days, including their history, attachments, links, and
		resume notes. After that, they are permanently deleted. Restoring a parent also restores subtasks
		moved with it.
	</p>
</div>

{#if data.issues.length}
	<ul
		class="divide-y divide-zinc-200 rounded border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800"
		aria-busy={busy}
	>
		{#each data.issues as issue (issue.id)}
			<li id="issue-{issue.id}" class="scroll-mt-4 p-3">
				<div class="flex flex-wrap items-center gap-2">
					<span class="text-xs text-zinc-500">#{issue.id}</span>
					<span class="min-w-0 flex-1 font-medium break-words">{issue.title}</span>
					<button
						class="btn py-1"
						disabled={busy || issue.trashedParentId !== null}
						onclick={() => restore(issue.id)}>Restore</button
					>
				</div>
				<p class="mt-1 text-xs text-zinc-500">
					{issue.appName} · Deleted
					<span title={fullDate(issue.deletedAt)}>{ago(issue.deletedAt)}</span>
					· Recover before {fullDate(issue.expiresAt)}
				</p>
				{#if issue.trashedParentId}
					<p class="mt-1 text-xs text-amber-700 dark:text-amber-400">
						<button
							class="underline disabled:opacity-50"
							disabled={busy}
							onclick={() => restore(issue.trashedParentId!)}
							>Restore parent #{issue.trashedParentId}</button
						>
						first.
						{issue.deletedWithParent === issue.trashedParentId
							? 'This subtask will return with it.'
							: 'Then you can restore this subtask.'}
					</p>
				{/if}
				{#if issue.description || issue.stopped || issue.nextAction}
					<details class="mt-2 text-sm">
						<summary class="cursor-pointer text-xs text-zinc-500 hover:underline"
							>Preview notes</summary
						>
						<div class="mt-2 space-y-3 rounded bg-zinc-50 p-3 dark:bg-zinc-900">
							{#if issue.stopped}<div>
									<p class="mb-1 text-xs font-medium text-zinc-500">Where I stopped</p>
									<p class="break-words whitespace-pre-wrap">{issue.stopped}</p>
								</div>{/if}
							{#if issue.nextAction}<div>
									<p class="mb-1 text-xs font-medium text-zinc-500">Next action</p>
									<p class="break-words whitespace-pre-wrap">{issue.nextAction}</p>
								</div>{/if}
							{#if issue.description}<Markdown source={issue.description} />{/if}
						</div>
					</details>
				{/if}
			</li>
		{/each}
	</ul>
{:else}
	<p
		class="rounded border border-dashed border-zinc-200 p-6 text-sm text-zinc-500 dark:border-zinc-800"
	>
		{data.total ? 'No issues on this page.' : 'Trash is empty.'}
	</p>
{/if}

{#if data.page > 1 || data.total > data.pageSize}
	<nav class="mt-4 flex items-center gap-3 text-sm" aria-label="Trash pages">
		{#if data.page > 1}<a class="hover:underline" href="/trash?page={data.page - 1}">← Newer</a
			>{/if}
		<span class="text-zinc-500">Page {data.page}</span>
		{#if data.total > data.page * data.pageSize}<a
				class="hover:underline"
				href="/trash?page={data.page + 1}">Older →</a
			>{/if}
	</nav>
{/if}
