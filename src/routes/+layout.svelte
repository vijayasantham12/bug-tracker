<script lang="ts">
	import './layout.css';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import QuickAdd from '#lib/components/QuickAdd.svelte';
	import NotificationBell from '#lib/components/NotificationBell.svelte';
	import { toast } from '#lib/toast.svelte.ts';
	import { nav } from '#lib/nav.svelte.ts';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();

	const links = [
		{ href: '/', label: 'Issues' },
		{ href: '/dashboard', label: 'Dashboard' },
		{ href: '/capture', label: 'Capture' },
		{ href: '/settings', label: 'Settings' }
	];
	const active = (href: string) =>
		href === '/'
			? page.url.pathname === '/' || page.url.pathname.startsWith('/issues')
			: page.url.pathname.startsWith(href);

	// `n` anywhere but the list (which has its own box) opens quick add in a popup; `m` opens capture
	let quickOpen = $state(false);
	let quickBox = $state<HTMLDivElement>();
	function closeQuick() {
		const text = quickBox?.querySelector('textarea')?.value.trim();
		if (text && !confirm('Discard what you typed in quick add?')) return;
		quickOpen = false;
	}
	onMount(() => {
		const onKey = (e: KeyboardEvent) => {
			const t = e.target as HTMLElement;
			// a page that handled the key (the list's `m` = milestone) wins
			if (!data.user || quickOpen || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey)
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
		return () => window.removeEventListener('keydown', onKey);
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
					href={l.href === '/' ? nav.listUrl : l.href}
					class={active(l.href)
						? 'text-zinc-900 dark:text-white'
						: 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'}>{l.label}</a
				>
			{/each}
			<span class="ml-auto hidden text-xs text-zinc-400 md:inline">
				<span class="kbd">n</span> new · <span class="kbd">m</span> capture ·
				<span class="kbd">/</span> search
			</span>
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
