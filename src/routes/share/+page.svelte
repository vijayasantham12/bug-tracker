<script lang="ts">
	import Paperclip from '~icons/octicon/paperclip-16';
	import X from '~icons/octicon/x-16';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { api, upload } from '#lib/api.ts';
	import { notify } from '#lib/toast.svelte.ts';
	import { SHARE_CACHE, SHARE_META, shareToIssue, type SharedMeta } from '#lib/share.ts';
	import { TYPES, TYPE_LABEL, type IssueType } from '#lib/types.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	let title = $state('');
	let description = $state('');
	let app = $state('');
	let type = $state<IssueType>('bug');
	let files = $state<File[]>([]);
	let previews = $state<string[]>([]);
	let loaded = $state(false);
	let busy = $state(false);

	const activeApps = $derived(data.apps.filter((a) => !a.archived));

	async function clearShare() {
		try {
			await caches.delete(SHARE_CACHE);
		} catch {
			// no Cache API (or blocked): nothing to clear
		}
	}

	onMount(() => {
		let urls: string[] = [];
		(async () => {
			const sp = page.url.searchParams;
			let meta: SharedMeta = {
				title: sp.get('title') ?? '',
				text: sp.get('text') ?? '',
				url: sp.get('url') ?? '',
				files: []
			};
			try {
				const cache = await caches.open(SHARE_CACHE);
				const hit = await cache.match(SHARE_META);
				if (hit) {
					meta = await hit.json();
					const got: File[] = [];
					for (const f of meta.files) {
						const res = await cache.match(f.key);
						if (res) got.push(new File([await res.blob()], f.name, { type: f.type }));
					}
					files = got;
				}
			} catch {
				// Cache API unavailable: use the query string only
			}
			({ title, description } = shareToIssue(meta));
			urls = files.map((f) => (f.type.startsWith('image/') ? URL.createObjectURL(f) : ''));
			previews = urls;
			loaded = true;
		})();
		return () => urls.forEach((u) => u && URL.revokeObjectURL(u));
	});

	async function add() {
		if (!title.trim() || busy) return;
		busy = true;
		try {
			const { ids } = await api<{ ids: number[] }>('POST', '/api/issues', {
				items: [{ title: title.trim(), description, apps: app ? [app] : [], type }]
			});
			if (files.length && data.attachmentsEnabled) await upload(ids[0], files, false);
			await clearShare();
			notify(`Added #${ids[0]}`);
			await goto(`/issues/${ids[0]}`, { replaceState: true });
		} catch {
			// api()/upload() already showed the error; keep the form so nothing is lost
		} finally {
			busy = false;
		}
	}

	async function discard() {
		await clearShare();
		await goto('/', { replaceState: true });
	}
</script>

<svelte:head><title>New issue from share · Bugs</title></svelte:head>

<div class="mx-auto max-w-xl">
	<h1 class="mb-3 text-lg font-semibold max-md:hidden">New issue from share</h1>
	{#if !loaded}
		<p class="py-10 text-center text-zinc-400">Reading what you shared…</p>
	{:else}
		<form
			class="space-y-3"
			onsubmit={(e) => {
				e.preventDefault();
				add();
			}}
		>
			<label class="block">
				<span class="mb-1 block text-xs text-zinc-500">Title</span>
				<input
					class="input w-full"
					bind:value={title}
					required
					maxlength="200"
					enterkeyhint="next"
				/>
			</label>
			<label class="block">
				<span class="mb-1 block text-xs text-zinc-500">Description</span>
				<textarea class="input w-full" rows="5" bind:value={description}></textarea>
			</label>
			<div class="flex gap-2">
				<label class="min-w-0 flex-1">
					<span class="mb-1 block text-xs text-zinc-500">App</span>
					<select class="input w-full" bind:value={app}>
						<option value="">Inbox (no app)</option>
						{#each activeApps as a (a.id)}<option value={a.name}>{a.name}</option>{/each}
					</select>
				</label>
				<label class="min-w-0 flex-1">
					<span class="mb-1 block text-xs text-zinc-500">Type</span>
					<select class="input w-full" bind:value={type}>
						{#each TYPES as t (t)}<option value={t}>{TYPE_LABEL[t]}</option>{/each}
					</select>
				</label>
			</div>
			{#if files.length}
				<ul class="flex flex-wrap gap-2">
					{#each files as f, i (i)}
						<li
							class="relative flex items-center gap-1.5 overflow-hidden rounded border border-zinc-200 text-xs dark:border-zinc-800"
						>
							{#if previews[i]}
								<img src={previews[i]} alt={f.name} class="size-20 object-cover" />
							{:else}
								<span class="flex items-center gap-1 px-2 py-2"
									><Paperclip aria-hidden="true" />{f.name}</span
								>
							{/if}
							<button
								type="button"
								class="absolute top-0.5 right-0.5 flex size-7 items-center justify-center rounded-full bg-zinc-900/70 text-white"
								aria-label="Remove {f.name}"
								onclick={() => {
									files = files.filter((_, j) => j !== i);
									previews = previews.filter((_, j) => j !== i);
								}}><X aria-hidden="true" /></button
							>
						</li>
					{/each}
				</ul>
				{#if !data.attachmentsEnabled}
					<p class="text-xs text-amber-700 dark:text-amber-400">
						Attachments are turned off on this server, so the files won't be added.
					</p>
				{/if}
			{/if}
			<div class="flex gap-2 pt-1">
				<button type="button" class="btn flex-1" onclick={discard}>Discard</button>
				<button class="btn-primary flex-1 py-2" disabled={!title.trim() || busy}
					>{busy ? 'Adding…' : 'Add issue'}</button
				>
			</div>
		</form>
	{/if}
</div>
