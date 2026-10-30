<script lang="ts">
	import { onMount } from 'svelte';
	import { parseQuickAdd } from '#lib/quickadd.ts';
	import { api, filesFrom, upload } from '#lib/api.ts';
	import { guardUnsaved } from '#lib/unsaved.ts';
	import { notify } from '#lib/toast.svelte.ts';
	import {
		PRIORITIES,
		TYPES,
		TYPE_LABEL,
		type App,
		type IssueType,
		type Milestone
	} from '#lib/types.ts';
	import { fileSize, TYPE_CLASS } from '#lib/format.ts';
	import { SimilarHints } from '#lib/similar.svelte.ts';
	import Autocomplete from './Autocomplete.svelte';

	let {
		apps,
		milestones = [],
		attachmentsEnabled,
		onadded,
		autofocus = false,
		inbox = false,
		onescape
	}: {
		apps: App[];
		milestones?: Milestone[];
		attachmentsEnabled: boolean;
		onadded?: (ids: number[]) => void;
		/** focus the box on mount (the popup from other pages) */
		autofocus?: boolean;
		/** Start captures without an app while processing Inbox. */
		inbox?: boolean;
		/** Esc in the box; defaults to just leaving it */
		onescape?: () => void;
	} = $props();

	let text = $state('');
	let defaultApp = $state('');
	let defaultType = $state<IssueType>('bug');
	let busy = $state(false);
	/** screenshots/files pasted or dropped into the box; attached to every created issue */
	let files = $state<File[]>([]);

	// busy covers the window where issues exist but their files are still uploading
	guardUnsaved(
		() => busy || !!text.trim() || files.length > 0,
		'Quick add has text or files that were not added yet. Leave anyway?'
	);
	let input = $state<HTMLTextAreaElement>();

	const parsed = $derived(parseQuickAdd(text));
	const known = $derived(new Set(apps.map((a) => a.name.toLowerCase())));
	const knownMilestones = $derived(new Set(milestones.map((m) => m.name.toLowerCase())));
	const hints = new SimilarHints();
	$effect(() => hints.check(parsed.map((p) => p.title)));
	const anyHints = $derived(parsed.some((p) => hints.get(p.title).length));
	const showPreview = $derived(
		anyHints || parsed.length > 1 || /(^|\s)[@!+^~*]\S|^\w+:|\s--\s/.test(text)
	);
	const dueLabel = (iso: string) =>
		new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, {
			weekday: 'short',
			day: 'numeric',
			month: 'short'
		});

	onMount(() => {
		try {
			defaultApp = localStorage.getItem('qa.app') ?? '';
			defaultType = (localStorage.getItem('qa.type') as IssueType) ?? 'bug';
		} catch {
			defaultApp = '';
		}
		if (autofocus) input?.focus();
		const onKey = (e: KeyboardEvent) => {
			const t = e.target as HTMLElement;
			if (
				t.closest('input, textarea, select, [contenteditable]') ||
				e.metaKey ||
				e.ctrlKey ||
				e.altKey
			)
				return;
			if (e.key === 'n' || e.key === 'c') {
				e.preventDefault();
				input?.focus();
			}
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	});

	$effect(() => {
		if (inbox) {
			defaultApp = '';
			defaultType = 'task';
		}
	});

	$effect(() => {
		try {
			localStorage.setItem('qa.app', defaultApp);
			localStorage.setItem('qa.type', defaultType);
		} catch {
			/* storage unavailable */
		}
	});

	function autosize() {
		if (!input) return;
		input.style.height = 'auto';
		input.style.height = `${input.scrollHeight}px`;
	}

	function addFiles(dt: DataTransfer | null, e: Event) {
		const list = filesFrom(dt);
		if (!list.length) return;
		e.preventDefault();
		if (!attachmentsEnabled) return notify('Attachments need S3 — see README', true);
		files = [...files, ...list];
	}

	async function submit() {
		if (!parsed.length || busy) return;
		const items = parsed.map((p) => ({
			...p,
			apps: p.apps.length ? p.apps : defaultApp ? [defaultApp] : [],
			type: p.type ?? defaultType
		}));
		busy = true;
		try {
			const { ids } = await api<{ ids: number[] }>('POST', '/api/issues', { items });
			notify(ids.length === 1 ? `Added #${ids[0]}` : `Added ${ids.length} issues`);
			text = '';
			if (files.length) {
				const pending = files;
				files = [];
				for (const [i, id] of ids.entries()) await upload(id, pending, i === ids.length - 1);
				notify(
					`Added ${ids.length === 1 ? `#${ids[0]}` : `${ids.length} issues`} with ${pending.length} file(s)`
				);
			}
			queueMicrotask(autosize);
			onadded?.(ids);
		} finally {
			busy = false;
			input?.focus();
		}
	}

	function onkeydown(e: KeyboardEvent) {
		// autocomplete already used this key (Tab / Esc)
		if (e.defaultPrevented) return;
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			submit();
		} else if (e.key === 'Escape') {
			if (onescape) onescape();
			else input?.blur();
		}
	}
</script>

<div
	role="group"
	ondragover={(e) => e.dataTransfer?.types.includes('Files') && e.preventDefault()}
	ondrop={(e) => addFiles(e.dataTransfer, e)}
	class="rounded-md border border-zinc-300 focus-within:border-zinc-500 dark:border-zinc-700 dark:focus-within:border-zinc-500"
>
	<div class="flex items-start gap-2 p-1.5">
		<select
			bind:value={defaultType}
			class="cell-select mx-0 py-1 {TYPE_CLASS[defaultType]}"
			title="Default type"
		>
			{#each TYPES as t (t)}<option value={t} class={TYPE_CLASS[t]}>{TYPE_LABEL[t]}</option>{/each}
		</select>
		<textarea
			bind:this={input}
			bind:value={text}
			{onkeydown}
			oninput={autosize}
			onpaste={(e) => addFiles(e.clipboardData, e)}
			rows="1"
			placeholder="Quick add… e.g.  checkout crashes on safari @shop !high +payments -- steps here"
			class="min-h-7 flex-1 resize-none bg-transparent px-1 py-1 outline-none placeholder:text-zinc-400"
		></textarea>
		<select
			bind:value={defaultApp}
			class="cell-select mx-0 max-w-40 py-1 text-zinc-500"
			title="Default app (when no @app)"
		>
			<option value="">Inbox (no app)</option>
			{#each apps.filter((a) => !a.archived) as a (a.id)}<option value={a.name}>{a.name}</option
				>{/each}
		</select>
		<button class="btn-primary" disabled={!parsed.length || busy} onclick={submit}>
			Add{parsed.length > 1 ? ` ${parsed.length}` : ''}
		</button>
	</div>

	<Autocomplete
		{input}
		apps={apps.filter((a) => !a.archived).map((a) => a.name)}
		milestones={milestones.filter((m) => !m.done).map((m) => m.name)}
	/>

	{#if files.length}
		<ul
			class="flex flex-wrap gap-1.5 border-t border-zinc-200 px-3 py-1.5 text-xs dark:border-zinc-800"
		>
			{#each files as f, i (i)}
				<li class="chip">
					📎 {f.name} <span class="text-zinc-400">{fileSize(f.size)}</span>
					<button class="text-zinc-400 hover:text-red-500" onclick={() => files.splice(i, 1)}
						>✕</button
					>
				</li>
			{/each}
		</ul>
	{/if}

	{#if showPreview && parsed.length}
		<ul class="space-y-0.5 border-t border-zinc-200 px-3 py-1.5 text-xs dark:border-zinc-800">
			{#each parsed as p, i (i)}
				{@const type = p.type ?? defaultType}
				{@const appsFor = p.apps.length ? p.apps : defaultApp ? [defaultApp] : []}
				<li class="flex flex-wrap items-center gap-2">
					<span class={TYPE_CLASS[type]}>{TYPE_LABEL[type]}</span>
					<span class="font-medium">{p.title}</span>
					{#each appsFor as a (a)}
						<span
							class="chip {known.has(a.toLowerCase()) ? '' : 'border-dashed'}"
							title={known.has(a.toLowerCase()) ? '' : 'New app'}
						>
							@{a}{known.has(a.toLowerCase()) ? '' : ' (new)'}
						</span>
					{:else}
						<span class="chip text-zinc-500">Inbox</span>
					{/each}
					{#if p.priority !== undefined}<span>{PRIORITIES[p.priority].label}</span>{/if}
					{#each p.labels ?? [] as l (l)}<span class="text-zinc-500">+{l}</span>{/each}
					{#if p.milestone}
						{@const isNew = !knownMilestones.has(p.milestone.toLowerCase())}
						<span class="chip {isNew ? 'border-dashed' : ''}"
							>^{p.milestone}{isNew ? ' (new)' : ''}</span
						>
					{/if}
					{#if p.size}<span class="text-zinc-500 uppercase">{p.size}</span>{/if}
					{#if p.dueDate}<span class="text-zinc-500">due {dueLabel(p.dueDate)}</span>{/if}
					{#if p.description}<span class="truncate text-zinc-400">— {p.description}</span>{/if}
				</li>
				{#each hints.get(p.title) as h (h.id)}
					<li class="pl-4 text-amber-700 dark:text-amber-400">
						≈ similar open issue
						<a href="/issues/{h.id}" target="_blank" rel="noopener" class="hover:underline"
							><span class="font-mono">#{h.id}</span> {h.title}</a
						>
						<span class="text-zinc-400">({h.statusName})</span>
					</li>
				{/each}
			{/each}
		</ul>
	{/if}
</div>
<p class="mt-1 text-xs text-zinc-400">
	<span class="kbd">Enter</span> add · <span class="kbd">Shift+Enter</span> one issue per line ·
	<code>@app</code> (repeat for several apps) · <code>!urgent !high !low</code> or <code>!0–3</code>
	·
	<code>+label</code> · <code>^milestone</code> · <code>~s ~m ~l</code> size ·
	<code>*fri</code> <code>*2w</code> due · <code>bug:</code>
	<code>feat:</code> <code>task:</code> <code>imp:</code> ·
	<code>-- description</code>{#if attachmentsEnabled}
		· paste or drop screenshots to attach{/if}
</p>
