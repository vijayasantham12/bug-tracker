<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { goto } from '$app/navigation';
	import type { App, Milestone, SearchIssue } from '#lib/types.ts';

	let {
		apps,
		milestones,
		onclose,
		oncreate
	}: {
		apps: App[];
		milestones: Milestone[];
		onclose: () => void;
		oncreate: () => void;
	} = $props();

	type Option = {
		id: string;
		label: string;
		detail: string;
		group: string;
		href?: string;
		create?: boolean;
		color?: string;
		keywords?: string;
	};
	let dialog: HTMLDialogElement;
	let input: HTMLInputElement;
	let query = $state('');
	let active = $state(0);
	let issues = $state<SearchIssue[]>([]);
	let loadedQuery = $state<string | null>(null);
	let loading = $state(true);
	let message = $state('');
	let retry = $state(0);
	const term = $derived(query.trim());
	const actions: Option[] = [
		{
			id: 'new',
			label: 'New issue',
			detail: 'Quick capture',
			group: 'Actions',
			create: true,
			keywords: 'create add bug feature task'
		},
		{
			id: 'today',
			label: 'Today',
			detail: 'Your focus list',
			group: 'Navigation',
			href: '/dashboard#today'
		},
		{
			id: 'inbox',
			label: 'Inbox',
			detail: 'Unorganized captures',
			group: 'Navigation',
			href: '/?inbox=1'
		},
		{
			id: 'dashboard',
			label: 'Dashboard',
			detail: 'What to work on next',
			group: 'Navigation',
			href: '/dashboard'
		},
		{
			id: 'issues',
			label: 'All issues',
			detail: 'Open and closed',
			group: 'Navigation',
			href: '/?status=all'
		},
		{
			id: 'milestones',
			label: 'Milestones',
			detail: 'Plans and Hill Charts',
			group: 'Navigation',
			href: '/milestones'
		},
		{
			id: 'capture',
			label: 'Capture',
			detail: 'Turn notes into issues',
			group: 'Navigation',
			href: '/capture'
		},
		{
			id: 'trash',
			label: 'Trash',
			detail: 'Restore deleted issues',
			group: 'Navigation',
			href: '/trash'
		},
		{
			id: 'settings',
			label: 'Settings',
			detail: 'Manage your tracker',
			group: 'Navigation',
			href: '/settings'
		}
	];
	const options = $derived.by((): Option[] => {
		const words = term.toLowerCase().split(/\s+/).filter(Boolean);
		const matches = (o: Option) =>
			words.every((w) => `${o.label} ${o.detail} ${o.keywords ?? ''}`.toLowerCase().includes(w));
		const local: Option[] = [...actions];
		if (term) {
			local.push(
				...apps
					.filter((a) => !a.archived)
					.map((a) => ({
						id: `app-${a.id}`,
						label: a.name,
						detail: 'Open issues in app',
						group: 'Apps',
						color: a.color,
						href: `/?${new URLSearchParams({ app: a.name })}`
					})),
				...milestones
					.filter((m) => !m.done)
					.map((m) => ({
						id: `milestone-${m.id}`,
						label: m.name,
						detail: 'Milestone',
						group: 'Milestones',
						href: `/milestones/${m.id}`
					}))
			);
		}
		const found: Option[] =
			loadedQuery === term
				? issues.map((i) => ({
						id: `issue-${i.id}`,
						label: i.title,
						detail: `#${i.id} · ${i.appName} · ${i.statusName}${i.nextAction ? ` · Next: ${i.nextAction}` : ''}`,
						group: term ? 'Issues' : 'Recent issues',
						href: `/issues/${i.id}`,
						color: i.appColor
					}))
				: [];
		return [
			...local.filter(matches).slice(0, term ? 10 : 4),
			...found,
			...(term
				? [
						{
							id: 'search',
							label: `Search all issues for “${term}”`,
							detail: 'View all matching results',
							group: 'Search',
							href: `/?${new URLSearchParams({ status: 'all', q: term })}`
						}
					]
				: [])
		];
	});

	$effect(() => {
		const q = term;
		void retry;
		const controller = new AbortController();
		loading = true;
		message = '';
		const timer = setTimeout(
			async () => {
				try {
					const response = await fetch(`/api/search?${new URLSearchParams({ q })}`, {
						signal: controller.signal,
						cache: 'no-store'
					});
					if (!response.ok) throw new Error('Search failed');
					const data = await response.json();
					if (controller.signal.aborted) return;
					issues = data.issues;
					loadedQuery = q;
				} catch {
					if (!controller.signal.aborted) message = 'Couldn’t search issues. Try again.';
				} finally {
					if (!controller.signal.aborted) loading = false;
				}
			},
			q ? 150 : 0
		);
		return () => {
			clearTimeout(timer);
			controller.abort();
		};
	});
	$effect(() => {
		if (active >= options.length) active = Math.max(0, options.length - 1);
		const id = options[active]?.id;
		if (id)
			void tick().then(() =>
				dialog?.querySelector(`[id="command-${id}"]`)?.scrollIntoView({ block: 'nearest' })
			);
	});

	function choose(option: Option) {
		onclose();
		if (option.create) oncreate();
		else if (option.href) void goto(option.href);
	}
	function onKey(event: KeyboardEvent) {
		// Keep list/detail shortcuts from receiving keys handled inside this modal.
		event.stopPropagation();
		if (event.isComposing) return;
		if (event.key === 'Tab') {
			const stops = dialog.querySelectorAll<HTMLElement>(
				'input:not([disabled]), button:not([disabled]):not([tabindex="-1"])'
			);
			const first = stops[0];
			const last = stops[stops.length - 1];
			if (event.shiftKey && document.activeElement === first) {
				event.preventDefault();
				last?.focus();
			} else if (!event.shiftKey && document.activeElement === last) {
				event.preventDefault();
				first?.focus();
			}
			return;
		}
		if (event.key === 'Escape') {
			event.preventDefault();
			onclose();
		} else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault();
			if (options.length)
				active = (active + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
		} else if (event.key === 'Enter' && event.target === input) {
			event.preventDefault();
			if (options[active]) choose(options[active]);
		}
	}
	onMount(() => {
		const previous = document.activeElement;
		dialog.showModal();
		input.focus();
		return () => {
			dialog.close();
			if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
		};
	});
</script>

<dialog
	bind:this={dialog}
	aria-labelledby="command-title"
	class="fixed inset-x-0 top-[min(15vh,6rem)] m-0 mx-auto w-[calc(100%-2rem)] max-w-xl overflow-hidden rounded-xl border border-zinc-200 bg-white p-0 text-zinc-800 shadow-2xl backdrop:bg-zinc-950/40 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200"
	onkeydown={onKey}
	oncancel={(event) => {
		event.preventDefault();
		onclose();
	}}
	onclick={(event) => {
		if (event.target !== dialog) return;
		const rect = dialog.getBoundingClientRect();
		if (
			event.clientX < rect.left ||
			event.clientX > rect.right ||
			event.clientY < rect.top ||
			event.clientY > rect.bottom
		)
			onclose();
	}}
>
	<h2 id="command-title" class="sr-only">Search issues and commands</h2>
	<div class="flex items-center gap-2 border-b border-zinc-200 px-4 dark:border-zinc-800">
		<svg
			class="shrink-0 text-zinc-400"
			width="18"
			height="18"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="1.7"
			aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4.5 4.5" /></svg
		>
		<input
			bind:this={input}
			bind:value={query}
			oninput={() => {
				active = 0;
			}}
			role="combobox"
			aria-label="Search issues and commands"
			aria-autocomplete="list"
			aria-expanded="true"
			aria-controls="command-results"
			aria-activedescendant={options[active] ? `command-${options[active].id}` : undefined}
			autocomplete="off"
			spellcheck="false"
			maxlength="200"
			placeholder="Search issues, apps, or commands…"
			class="min-w-0 flex-1 bg-transparent py-4 outline-none"
		/>
		<button
			type="button"
			class="kbd py-0.5 hover:bg-zinc-100 dark:hover:bg-zinc-800"
			aria-label="Close command palette"
			onclick={onclose}>Esc</button
		>
	</div>
	<div
		id="command-results"
		role="listbox"
		tabindex="-1"
		aria-label="Results"
		class="max-h-[min(55dvh,26rem)] overflow-y-auto overscroll-contain p-2"
	>
		{#each options as option, index (option.id)}
			{#if index === 0 || options[index - 1].group !== option.group}<div
					role="presentation"
					class="px-2 pt-2 pb-1 text-[11px] font-medium tracking-wide text-zinc-400 uppercase"
				>
					{option.group}
				</div>{/if}
			<button
				id="command-{option.id}"
				type="button"
				role="option"
				aria-selected={active === index}
				tabindex="-1"
				class="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left {active === index
					? 'bg-zinc-100 dark:bg-zinc-800'
					: ''}"
				onpointermove={() => {
					active = index;
				}}
				onclick={() => choose(option)}
			>
				{#if option.color}<span class="size-2 shrink-0 rounded-full" style:background={option.color}
					></span>{:else}<span class="w-2 shrink-0 text-zinc-400" aria-hidden="true"
						>{option.create ? '+' : '›'}</span
					>{/if}
				<span class="min-w-0 flex-1"
					><span class="block truncate text-sm">{option.label}</span><span
						class="block truncate text-xs text-zinc-500">{option.detail}</span
					></span
				>
				{#if active === index}<span class="text-xs text-zinc-400" aria-hidden="true">↵</span>{/if}
			</button>
		{/each}
	</div>
	{#if loading}<p role="status" class="px-5 py-2 text-xs text-zinc-500">
			Searching issues…
		</p>{:else if message}<p
			role="alert"
			class="flex items-center gap-2 px-5 py-2 text-xs text-red-600 dark:text-red-400"
		>
			{message}<button
				type="button"
				class="underline"
				onclick={() => {
					retry += 1;
				}}>Retry</button
			>
		</p>{:else if term && !issues.length}<p role="status" class="px-5 py-2 text-xs text-zinc-500">
			No matching issues.
		</p>{/if}
	<div
		class="flex gap-3 border-t border-zinc-200 px-4 py-2 text-[11px] text-zinc-500 dark:border-zinc-800"
	>
		<span>↑ ↓ navigate</span><span>↵ open</span><span class="ml-auto">Esc close</span>
	</div>
</dialog>
