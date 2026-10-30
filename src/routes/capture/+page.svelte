<script lang="ts">
	import { onMount } from 'svelte';
	import Autocomplete from '#lib/components/Autocomplete.svelte';
	import { api } from '#lib/api.ts';
	import { parseCapture } from '#lib/quickadd.ts';
	import { notify } from '#lib/toast.svelte.ts';
	import { SimilarHints } from '#lib/similar.svelte.ts';
	import { PRIORITIES, TYPES, TYPE_LABEL, type IssueType } from '#lib/types.ts';
	import { TYPE_CLASS, PRIORITY_CLASS } from '#lib/format.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const MONTHS = [
		'jan',
		'feb',
		'mar',
		'apr',
		'may',
		'jun',
		'jul',
		'aug',
		'sep',
		'oct',
		'nov',
		'dec'
	];
	const todaysLabel = () => {
		const d = new Date();
		return `meeting-${MONTHS[d.getMonth()]}${d.getDate()}`;
	};

	let text = $state('');
	let defaults = $state({ app: '', milestone: '', type: 'bug' as IssueType, label: todaysLabel() });
	let input = $state<HTMLTextAreaElement>();
	let busy = $state(false);
	let restored = $state(false);
	let result = $state<{ ids: number[]; subtasks: number; label: string } | null>(null);

	const activeApps = $derived(data.apps.filter((a) => !a.archived));
	const openMilestones = $derived(data.milestones.filter((m) => !m.done));
	const label = $derived(defaults.label.trim().toLowerCase().replace(/\s+/g, '-'));

	const items = $derived(
		parseCapture(text).map((it) => ({
			...it,
			apps: it.apps.length ? it.apps : defaults.app ? [defaults.app] : [],
			type: it.type ?? defaults.type,
			milestone: it.milestone ?? (defaults.milestone || undefined),
			labels: [...new Set([...(label ? [label] : []), ...(it.labels ?? [])])]
		}))
	);
	const subtaskCount = $derived(items.reduce((n, it) => n + it.subtasks.length, 0));
	const hints = new SimilarHints();
	$effect(() =>
		hints.check(
			items.map((it) => it.title),
			700
		)
	);

	// draft and defaults live in this browser, so a refresh or closed tab loses nothing
	const DRAFT = 'capture.draft';
	const DEFAULTS = 'capture.defaults';
	onMount(() => {
		try {
			text = localStorage.getItem(DRAFT) ?? '';
			const saved = JSON.parse(localStorage.getItem(DEFAULTS) ?? 'null');
			if (saved) defaults = { ...defaults, ...saved };
			// a new meeting (empty draft) gets today's label
			if (!text.trim()) defaults.label = todaysLabel();
		} catch {
			// storage blocked: start empty
		}
		restored = true;
		input?.focus();
	});
	$effect(() => {
		if (!restored) return;
		try {
			localStorage.setItem(DRAFT, text);
			localStorage.setItem(DEFAULTS, JSON.stringify(defaults));
		} catch {
			// storage blocked: nothing to persist to
		}
	});

	async function addAll() {
		if (!items.length || busy) return;
		busy = true;
		try {
			const { ids, subtaskIds } = await api<{ ids: number[]; subtaskIds: number[] }>(
				'POST',
				'/api/issues',
				{ items }
			);
			result = { ids, subtasks: subtaskIds.length, label };
			text = '';
			notify(`Added ${ids.length} issue${ids.length === 1 ? '' : 's'}`);
		} finally {
			busy = false;
			input?.focus();
		}
	}

	// ---------- editor keys: Tab indents, Enter continues the list ----------

	/** Inserts via execCommand so the browser's undo still works; falls back to setRangeText. */
	function replace(from: number, to: number, str: string, caret = from + str.length) {
		if (!input) return;
		input.setSelectionRange(from, to);
		if (!document.execCommand('insertText', false, str)) {
			input.setRangeText(str, from, to, 'end');
			input.dispatchEvent(new Event('input', { bubbles: true }));
		}
		input.setSelectionRange(caret, caret);
	}

	const BULLET_LINE = /^(\s*)([-*•]|\d+[.)])(\s+)(\[[ xX]\]\s+)?(.*)$/;

	function onkeydown(e: KeyboardEvent) {
		if (!input || e.defaultPrevented) return;
		const v = input.value;
		const pos = input.selectionStart;
		const lineStart = v.lastIndexOf('\n', pos - 1) + 1;
		const line = v.slice(lineStart, pos);

		if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
			e.preventDefault();
			addAll();
		} else if (e.key === 'Tab') {
			e.preventDefault();
			if (e.shiftKey) {
				const n = /^ {1,2}/.exec(v.slice(lineStart))?.[0].length ?? 0;
				if (n) replace(lineStart, lineStart + n, '', pos - n);
			} else replace(lineStart, lineStart, '  ', pos + 2);
		} else if (e.key === 'Enter' && !e.shiftKey && !e.altKey) {
			const m = BULLET_LINE.exec(line);
			if (m && !m[5].trim()) {
				// Enter on an empty bullet: step out a level, or end the list
				e.preventDefault();
				if (m[1].length >= 2) replace(lineStart, lineStart + 2, '', pos - 2);
				else replace(lineStart, pos, '');
			} else if (m) {
				e.preventDefault();
				const next = /^\d+/.test(m[2]) ? `${Number.parseInt(m[2]) + 1}${m[2].slice(-1)}` : m[2];
				replace(pos, pos, `\n${m[1]}${next}${m[3]}`);
			} else {
				const indent = /^\s+/.exec(line)?.[0];
				if (indent) {
					e.preventDefault();
					replace(pos, pos, `\n${indent}`);
				}
			}
		}
	}

	const dueLabel = (iso: string) =>
		new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, {
			weekday: 'short',
			day: 'numeric',
			month: 'short'
		});
</script>

<svelte:head><title>Capture · Bugs</title></svelte:head>

<div class="mb-3 flex flex-wrap items-center gap-2">
	<h1 class="mr-2 font-semibold">Meeting capture</h1>
	<label class="flex items-center gap-1 text-xs text-zinc-500"
		>app
		<select bind:value={defaults.app} class="input py-0.5">
			<option value="">Inbox (no app)</option>
			{#each activeApps as a (a.id)}<option value={a.name}>{a.name}</option>{/each}
		</select>
	</label>
	<label class="flex items-center gap-1 text-xs text-zinc-500"
		>milestone
		<select bind:value={defaults.milestone} class="input py-0.5">
			<option value="">—</option>
			{#each openMilestones as m (m.id)}<option value={m.name}>{m.name}</option>{/each}
		</select>
	</label>
	<label class="flex items-center gap-1 text-xs text-zinc-500"
		>type
		<select bind:value={defaults.type} class="input py-0.5 {TYPE_CLASS[defaults.type]}">
			{#each TYPES as t (t)}<option value={t} class={TYPE_CLASS[t]}>{TYPE_LABEL[t]}</option>{/each}
		</select>
	</label>
	<label class="flex items-center gap-1 text-xs text-zinc-500"
		>label +
		<input bind:value={defaults.label} class="input w-36 py-0.5" placeholder="none" />
	</label>
</div>

{#if result}
	<div
		class="mb-3 flex flex-wrap items-baseline gap-x-2 rounded border border-green-300 bg-green-50 px-3 py-2 text-sm dark:border-green-900 dark:bg-green-950/40"
	>
		<span class="font-medium"
			>Added {result.ids.length} issue{result.ids.length === 1 ? '' : 's'}{result.subtasks
				? ` + ${result.subtasks} subtask${result.subtasks === 1 ? '' : 's'}`
				: ''}:</span
		>
		{#each result.ids as id (id)}<a href="/issues/{id}" class="hover:underline">#{id}</a>{/each}
		{#if result.label}
			<a
				href="/?label={encodeURIComponent(result.label)}&status=all"
				class="ml-auto hover:underline">see all +{result.label} →</a
			>
		{/if}
		<button class="text-zinc-400 hover:text-zinc-700" onclick={() => (result = null)}>✕</button>
	</div>
{/if}

<div class="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-2">
	<div
		class="flex flex-col rounded-md border border-zinc-300 focus-within:border-zinc-500 dark:border-zinc-700"
	>
		<textarea
			bind:this={input}
			bind:value={text}
			{onkeydown}
			spellcheck="true"
			placeholder={`Type while they talk — one issue per line, nothing is saved until Add all.

- checkout crash on safari !high
  only with apple pay            ← indented text: description
- csv export @crm *fri
  - add date filter              ← indented bullet: subtask
  - zip download ~s
feat: dark mode ^v1.4

Tab indents · Enter continues the list · Ctrl+Enter adds all`}
			class="min-h-[55vh] flex-1 resize-y bg-transparent p-3 leading-relaxed outline-none placeholder:text-zinc-400"
		></textarea>
		<Autocomplete
			{input}
			apps={activeApps.map((a) => a.name)}
			milestones={openMilestones.map((m) => m.name)}
		/>
	</div>

	<section class="min-w-0">
		<h2 class="mb-2 text-xs font-medium tracking-wide text-zinc-500 uppercase">
			Will create · {items.length} issue{items.length === 1 ? '' : 's'}{subtaskCount
				? ` + ${subtaskCount} subtask${subtaskCount === 1 ? '' : 's'}`
				: ''}
		</h2>
		{#if !items.length}
			<p class="text-zinc-400">The preview of each issue appears here as you type.</p>
		{/if}
		<ol class="space-y-2">
			{#each items as it, i (i)}
				<li class="rounded border border-zinc-200 px-2.5 py-1.5 dark:border-zinc-800">
					<div class="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
						<span class="text-xs {TYPE_CLASS[it.type]}">{TYPE_LABEL[it.type]}</span>
						<span class="font-medium">{it.title}</span>
						{#each it.apps as a (a)}<span class="text-xs text-zinc-500">@{a}</span>{:else}<span
								class="text-xs text-zinc-500">Inbox</span
							>{/each}
						{#if it.priority !== undefined && it.priority !== 2}<span
								class="text-xs {PRIORITY_CLASS[it.priority]}">{PRIORITIES[it.priority].label}</span
							>{/if}
						{#if it.milestone}<span class="text-xs text-zinc-500">^{it.milestone}</span>{/if}
						{#if it.size}<span class="text-xs text-zinc-500 uppercase">{it.size}</span>{/if}
						{#if it.dueDate}<span class="text-xs text-zinc-500">due {dueLabel(it.dueDate)}</span
							>{/if}
						{#each it.labels as l (l)}<span class="text-xs text-zinc-400">+{l}</span>{/each}
					</div>
					{#if it.description}
						<p class="mt-0.5 line-clamp-2 text-xs whitespace-pre-line text-zinc-500">
							{it.description}
						</p>
					{/if}
					{#each it.subtasks as sub, j (j)}
						<div class="mt-0.5 text-sm">
							<span class="text-zinc-400">↳</span>
							{sub.title}
							{#if sub.dueDate}<span class="text-xs text-zinc-500">due {dueLabel(sub.dueDate)}</span
								>{/if}
							{#if sub.description}<span class="text-xs text-zinc-400">
									— {sub.description}</span
								>{/if}
						</div>
					{/each}
					{#each hints.get(it.title) as h (h.id)}
						<div class="mt-0.5 text-xs text-amber-700 dark:text-amber-400">
							≈ similar open
							<a href="/issues/{h.id}" target="_blank" rel="noopener" class="hover:underline"
								><span class="font-sans">#{h.id}</span> {h.title}</a
							>
							<span class="text-zinc-400">({h.statusName})</span>
						</div>
					{/each}
				</li>
			{/each}
		</ol>
	</section>
</div>

<div
	class="sticky bottom-0 mt-3 flex items-center gap-3 border-t border-zinc-200 bg-white py-2 dark:border-zinc-800 dark:bg-zinc-950"
>
	<span class="text-sm text-zinc-500">
		{items.length} issue{items.length === 1 ? '' : 's'}{subtaskCount
			? ` · ${subtaskCount} subtasks`
			: ''}
		{#if text.trim()}<span class="text-xs text-zinc-400"> · draft saved in this browser</span>{/if}
	</span>
	{#if text.trim()}
		<button
			class="text-xs text-zinc-400 hover:text-red-500"
			onclick={() => confirm('Clear the whole draft?') && (text = '')}>clear</button
		>
	{/if}
	<button class="btn-primary ml-auto" disabled={!items.length || busy} onclick={addAll}>
		{busy ? 'Adding…' : `Add all${items.length ? ` ${items.length}` : ''}`}
		<span class="ml-1 text-xs opacity-60">Ctrl+Enter</span>
	</button>
</div>
