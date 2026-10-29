<script lang="ts">
	import './layout.css';
	import { onMount } from 'svelte';
	import { afterNavigate, goto } from '$app/navigation';
	import { page } from '$app/state';
	import QuickAdd from '#lib/components/QuickAdd.svelte';
	import NotificationBell from '#lib/components/NotificationBell.svelte';
	import CommandPalette from '#lib/components/CommandPalette.svelte';
	import { toast } from '#lib/toast.svelte.ts';
	import { nav } from '#lib/nav.svelte.ts';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();

	const links = [
		{ href: '/', label: 'Issues' },
		{ href: '/?inbox=1', label: 'Inbox' },
		{ href: '/dashboard', label: 'Dashboard' },
		{ href: '/milestones', label: 'Milestones' },
		{ href: '/capture', label: 'Capture' },
		{ href: '/trash', label: 'Trash' },
		{ href: '/settings', label: 'Settings' }
	];
	const active = (href: string) =>
		href === '/?inbox=1'
			? page.url.pathname === '/' && page.url.searchParams.get('inbox') === '1'
			: href === '/'
				? (page.url.pathname === '/' && page.url.searchParams.get('inbox') !== '1') ||
					page.url.pathname.startsWith('/issues')
				: page.url.pathname.startsWith(href);

	// `n` anywhere but the list (which has its own box) opens quick add in a popup; `m` opens capture
	let quickOpen = $state(false);
	let commandOpen = $state(false);
	let commandShortcut = $state('Ctrl K');
	afterNavigate(() => {
		commandOpen = false;
	});
	let quickBox = $state<HTMLDivElement>();
	function closeQuick() {
		const text = quickBox?.querySelector('textarea')?.value.trim();
		if (text && !confirm('Discard what you typed in quick add?')) return;
		quickOpen = false;
	}
	onMount(() => {
		if (/Mac|iPhone|iPad/.test(navigator.platform)) commandShortcut = '⌘ K';
		const onCommandKey = (e: KeyboardEvent) => {
			if (
				!data.user ||
				e.isComposing ||
				e.altKey ||
				!(e.ctrlKey || e.metaKey) ||
				e.key.toLowerCase() !== 'k'
			)
				return;
			e.preventDefault();
			e.stopPropagation();
			// Preserve any draft in the existing quick-add popup.
			if (!quickOpen) commandOpen = !commandOpen;
		};
		const onKey = (e: KeyboardEvent) => {
			const t = e.target as HTMLElement;
			// a page that handled the key (the list's `m` = milestone) wins
			if (
				!data.user ||
				quickOpen ||
				commandOpen ||
				e.defaultPrevented ||
				e.metaKey ||
				e.ctrlKey ||
				e.altKey
			)
				return;
			if (t.closest('input, textarea, select, [contenteditable]')) return;
			if (e.key === 'n' && page.url.pathname !== '/') {
				e.preventDefault();
				quickOpen = true;
			} else if (e.key === 'm' && page.url.pathname !== '/capture') {
				e.preventDefault();
				goto('/capture');
			}
		};
		window.addEventListener('keydown', onKey);
		window.addEventListener('keydown', onCommandKey, true);
		return () => {
			window.removeEventListener('keydown', onKey);
			window.removeEventListener('keydown', onCommandKey, true);
		};
	});
</script>

<svelte:head>
	<title>Bugs</title>
</svelte:head>

{#if data.user}
	<header class="border-b border-zinc-200 dark:border-zinc-800">
		<nav class="mx-auto flex max-w-7xl flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2 sm:gap-x-4">
			<a href={nav.listUrl} class="font-semibold tracking-tight">🐞 bugs</a>
			{#each links as l (l.href)}
				<a
					href={l.href === '/' && !nav.listUrl.includes('inbox=1') ? nav.listUrl : l.href}
					class={active(l.href)
						? 'text-zinc-900 dark:text-white'
						: 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'}
					>{l.label}{#if l.label === 'Inbox' && data.inboxCount}<span
							class="ml-1 text-xs opacity-60">{data.inboxCount}</span
						>{/if}</a
				>
			{/each}
			<button
				type="button"
				class="ml-auto inline-flex items-center gap-2 rounded border border-zinc-200 px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
				aria-label="Search issues and commands"
				aria-keyshortcuts="Control+k Meta+k"
				aria-haspopup="dialog"
				aria-expanded={commandOpen}
				onclick={() => {
					if (!quickOpen) commandOpen = true;
				}}
			>
				<span>Search…</span><span class="kbd">{commandShortcut}</span>
			</button>
			<div class="ml-auto flex items-center gap-2 md:ml-2">
				<NotificationBell initialUnread={data.unreadCount} />
				<form method="POST" action="/logout" class="flex items-center gap-2 text-xs">
					<span class="text-zinc-500" title={data.user.email}>{data.user.name}</span>
					<button class="text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200"
						>Sign out</button
					>
				</form>
			</div>
		</nav>
	</header>
{/if}

<main class="mx-auto max-w-7xl px-4 py-4">
	{@render children()}
</main>

{#if commandOpen && data.user}
	<CommandPalette
		apps={data.apps}
		milestones={data.milestones}
		onclose={() => {
			commandOpen = false;
		}}
		oncreate={() => {
			quickOpen = true;
		}}
	/>
{/if}

{#if quickOpen}
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div
		class="fixed inset-0 z-40 flex items-start justify-center bg-zinc-950/30 px-4 pt-[15vh]"
		onclick={(e) => e.target === e.currentTarget && closeQuick()}
	>
		<div
			bind:this={quickBox}
			class="w-full max-w-2xl rounded-lg bg-white p-3 shadow-xl dark:bg-zinc-950"
			role="dialog"
			aria-label="Quick add"
		>
			<QuickAdd
				apps={data.apps}
				milestones={data.milestones}
				attachmentsEnabled={data.attachmentsEnabled}
				autofocus
				onescape={closeQuick}
				onadded={() => (quickOpen = false)}
			/>
		</div>
	</div>
{/if}

{#if toast.message}
	<div
		class="fixed right-4 bottom-4 rounded px-3 py-2 text-sm shadow-lg {toast.error
			? 'bg-red-600 text-white'
			: 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'}"
	>
		{toast.message}
	</div>
{/if}
