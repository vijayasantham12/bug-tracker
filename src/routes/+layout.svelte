<script lang="ts">
	import Bug from '~icons/octicon/bug-16';
	import IssueOpened from '~icons/octicon/issue-opened-16';
	import IssueClosed from '~icons/octicon/issue-closed-16';
	import Inbox from '~icons/octicon/inbox-16';
	import Pulse from '~icons/octicon/pulse-16';
	import Milestone from '~icons/octicon/milestone-16';
	import Note from '~icons/octicon/note-16';
	import Trash from '~icons/octicon/trash-16';
	import Gear from '~icons/octicon/gear-16';
	import Plus from '~icons/octicon/plus-16';
	import Search from '~icons/octicon/search-16';
	import KebabHorizontal from '~icons/octicon/kebab-horizontal-16';
	import SignOut from '~icons/octicon/sign-out-16';
	import Sync from '~icons/octicon/sync-16';
	import './layout.css';
	import { onMount } from 'svelte';
	import { afterNavigate, goto, refreshAll } from '$app/navigation';
	import { page } from '$app/state';
	import QuickAdd from '#lib/components/QuickAdd.svelte';
	import NotificationBell from '#lib/components/NotificationBell.svelte';
	import CommandPalette from '#lib/components/CommandPalette.svelte';
	import Sheet from '#lib/components/Sheet.svelte';
	import { isStandalone, pullToRefresh, trackKeyboard } from '#lib/gestures.ts';
	import { toast } from '#lib/toast.svelte.ts';
	import { nav } from '#lib/nav.svelte.ts';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();

	const links = [
		{ href: '/', label: 'Issues', icon: IssueOpened },
		{ href: '/?inbox=1', label: 'Inbox', icon: Inbox },
		{ href: '/dashboard', label: 'Dashboard', icon: Pulse },
		{ href: '/done', label: 'Done', icon: IssueClosed },
		{ href: '/milestones', label: 'Milestones', icon: Milestone },
		{ href: '/capture', label: 'Capture', icon: Note },
		{ href: '/trash', label: 'Trash', icon: Trash },
		{ href: '/settings', label: 'Settings', icon: Gear }
	];
	const active = (href: string) =>
		href === '/?inbox=1'
			? page.url.pathname === '/' && page.url.searchParams.get('inbox') === '1'
			: href === '/'
				? (page.url.pathname === '/' && page.url.searchParams.get('inbox') !== '1') ||
					page.url.pathname.startsWith('/issues')
				: page.url.pathname.startsWith(href);

	// phones: four tabs + a quick-add button in a bottom bar; the rest lives under More
	const tabs = [links[0], links[1], links[2]];
	const moreLinks = links.filter((l) => !tabs.includes(l));
	const moreActive = $derived(moreLinks.some((l) => active(l.href)));
	const title = $derived(
		page.url.pathname.startsWith('/issues/')
			? 'Issue'
			: page.url.pathname === '/share'
				? 'New issue'
				: (links.find((l) => active(l.href))?.label ?? 'Bugs')
	);
	let moreOpen = $state(false);
	// one bell at a time (each polls and listens for outside clicks)
	let phone = $state(false);
	let ptr = $state<HTMLDivElement>();

	// `n` anywhere but the list (which has its own box) opens quick add in a popup; `m` opens capture
	let quickOpen = $state(false);
	let commandOpen = $state(false);
	let commandShortcut = $state('Ctrl K');
	afterNavigate(() => {
		commandOpen = false;
		moreOpen = false;
		// the manifest's "Quick add" shortcut opens /?new=1
		if (data.user && page.url.searchParams.get('new') === '1') {
			const url = new URL(page.url.href);
			url.searchParams.delete('new');
			quickOpen = true;
			goto(url, { replaceState: true, reset: false });
		}
	});
	let quickBox = $state<HTMLDivElement>();
	function closeQuick() {
		const text = quickBox?.querySelector('textarea')?.value.trim();
		if (text && !confirm('Discard what you typed in quick add?')) return;
		quickOpen = false;
	}
	onMount(() => {
		if (/Mac|iPhone|iPad/.test(navigator.platform)) commandShortcut = '⌘ K';
		const stopKeyboard = trackKeyboard();
		const mq = matchMedia('(max-width: 767.98px)');
		const onMq = () => (phone = mq.matches);
		onMq();
		mq.addEventListener('change', onMq);
		const stopPull =
			ptr && isStandalone() && matchMedia('(pointer: coarse)').matches
				? pullToRefresh(ptr, refreshAll)
				: () => {};
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
			stopKeyboard();
			stopPull();
			mq.removeEventListener('change', onMq);
			window.removeEventListener('keydown', onKey);
			window.removeEventListener('keydown', onCommandKey, true);
		};
	});
</script>

<svelte:head>
	<title>Bugs</title>
</svelte:head>

{#if data.user}
	<!-- phones: compact title bar under the status bar (solid, no backdrop-filter: that would trap the
	     bell's fixed-position sheet inside the header) -->
	<header
		class="sticky top-0 z-40 border-b border-zinc-200 bg-white pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)] select-none md:hidden dark:border-zinc-800 dark:bg-zinc-950"
	>
		<div class="flex h-12 items-center gap-1 px-4">
			<a href={nav.listUrl} class="mr-1 text-zinc-400" aria-label="bugs, back to the issue list"
				><Bug aria-hidden="true" class="icon size-4" /></a
			>
			<h1 class="min-w-0 flex-1 truncate text-base font-semibold">{title}</h1>
			<button
				type="button"
				class="flex size-10 items-center justify-center rounded-full text-zinc-500 active:bg-zinc-100 dark:active:bg-zinc-800"
				aria-label="Search issues and commands"
				aria-haspopup="dialog"
				aria-expanded={commandOpen}
				onclick={() => {
					if (!quickOpen) commandOpen = true;
				}}><Search aria-hidden="true" class="icon size-5" /></button
			>
			{#if phone}<NotificationBell initialUnread={data.unreadCount} />{/if}
		</div>
	</header>

	<header class="hidden border-b border-zinc-200 md:block dark:border-zinc-800">
		<nav class="mx-auto flex max-w-7xl flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2 sm:gap-x-4">
			<a href={nav.listUrl} class="font-semibold tracking-tight"
				><Bug aria-hidden="true" class="icon mr-1" />bugs</a
			>
			{#each links as l (l.href)}
				<a
					href={l.href === '/' && !nav.listUrl.includes('inbox=1') ? nav.listUrl : l.href}
					class={active(l.href)
						? 'text-zinc-900 dark:text-white'
						: 'text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200'}
					><l.icon
						aria-hidden="true"
						class="icon mr-1 opacity-70"
					/>{l.label}{#if l.label === 'Inbox' && data.inboxCount}<span
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
			<div class="ml-2 flex items-center gap-2">
				{#if !phone}<NotificationBell initialUnread={data.unreadCount} />{/if}
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

<main
	class="mx-auto max-w-7xl px-[max(1rem,env(safe-area-inset-left))] py-4 {data.user
		? 'pb-[calc(5rem+env(safe-area-inset-bottom))] md:pb-4'
		: 'pt-[max(1rem,env(safe-area-inset-top))]'}"
>
	{@render children()}
</main>

{#if data.user}
	<!-- pull-to-refresh spinner (installed app only) -->
	<div
		bind:this={ptr}
		class="pointer-events-none fixed top-[calc(3.5rem+env(safe-area-inset-top))] left-1/2 z-20 flex size-9 -translate-x-1/2 -translate-y-10 items-center justify-center rounded-full bg-white text-zinc-500 opacity-0 shadow-md md:hidden dark:bg-zinc-800 dark:text-zinc-300"
		aria-hidden="true"
	>
		<span class="flex"><Sync class="icon size-4" /></span>
	</div>

	<!-- phones: bottom tab bar -->
	<nav
		aria-label="Main"
		class="fixed inset-x-0 bottom-0 z-30 border-t border-zinc-200 bg-white/90 pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] backdrop-blur-md select-none md:hidden dark:border-zinc-800 dark:bg-zinc-950/90"
	>
		<div class="grid h-14 grid-cols-5 items-stretch">
			{#snippet tab(href: string, label: string, Icon: typeof Bug, on: boolean, badge = 0)}
				<a
					{href}
					aria-current={on ? 'page' : undefined}
					class="tab relative flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium {on
						? 'text-zinc-900 dark:text-white'
						: 'text-zinc-400 dark:text-zinc-500'}"
				>
					<Icon aria-hidden="true" class="icon size-5" />{label}
					{#if badge}<span
							class="absolute top-1.5 left-1/2 ml-2 min-w-4 rounded-full bg-zinc-900 px-1 text-center text-[10px] leading-4 text-white dark:bg-zinc-100 dark:text-zinc-900"
							>{badge > 99 ? '99+' : badge}</span
						>{/if}
				</a>
			{/snippet}
			{@render tab(
				!nav.listUrl.includes('inbox=1') ? nav.listUrl : '/',
				'Issues',
				IssueOpened,
				active('/')
			)}
			{@render tab('/?inbox=1', 'Inbox', Inbox, active('/?inbox=1'), data.inboxCount)}
			<div class="flex items-center justify-center">
				<button
					type="button"
					class="tab flex size-12 items-center justify-center rounded-full bg-zinc-900 text-white shadow-md active:scale-95 dark:bg-zinc-100 dark:text-zinc-900"
					aria-label="Quick add issue"
					onclick={() => {
						commandOpen = false;
						quickOpen = true;
					}}><Plus aria-hidden="true" class="icon size-6" /></button
				>
			</div>
			{@render tab('/dashboard', 'Dashboard', Pulse, active('/dashboard'))}
			<button
				type="button"
				class="tab flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium {moreActive ||
				moreOpen
					? 'text-zinc-900 dark:text-white'
					: 'text-zinc-400 dark:text-zinc-500'}"
				aria-haspopup="dialog"
				aria-expanded={moreOpen}
				onclick={() => (moreOpen = true)}
				><KebabHorizontal aria-hidden="true" class="icon size-5" />More</button
			>
		</div>
	</nav>

	{#if moreOpen}
		<Sheet label="More" onclose={() => (moreOpen = false)} width="md:max-w-sm">
			<ul class="divide-y divide-zinc-100 dark:divide-zinc-900">
				{#each moreLinks as l (l.href)}
					<li>
						<a
							href={l.href}
							class="flex h-12 items-center gap-3 rounded px-2 text-base active:bg-zinc-100 dark:active:bg-zinc-900 {active(
								l.href
							)
								? 'font-semibold'
								: ''}"><l.icon aria-hidden="true" class="icon size-5 text-zinc-400" />{l.label}</a
						>
					</li>
				{/each}
				<li>
					<form method="POST" action="/logout" class="flex h-14 items-center gap-3 px-2">
						<span class="min-w-0 flex-1 truncate text-sm text-zinc-500"
							>{data.user.name} <span class="text-zinc-400">· {data.user.email}</span></span
						>
						<button class="btn flex items-center gap-1.5"
							><SignOut aria-hidden="true" class="icon" />Sign out</button
						>
					</form>
				</li>
			</ul>
		</Sheet>
	{/if}
{/if}

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
	<Sheet label="Quick add" onclose={closeQuick}>
		<div bind:this={quickBox}>
			<QuickAdd
				apps={data.apps}
				milestones={data.milestones}
				attachmentsEnabled={data.attachmentsEnabled}
				inbox={page.url.pathname === '/' && page.url.searchParams.get('inbox') === '1'}
				autofocus
				onadded={() => (quickOpen = false)}
			/>
		</div>
	</Sheet>
{/if}

{#if toast.message}
	<div
		role="status"
		class="fixed inset-x-4 bottom-[calc(4.5rem+env(safe-area-inset-bottom)+var(--kb))] z-[60] flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm shadow-lg md:inset-x-auto md:right-4 md:bottom-4 md:rounded {toast.error
			? 'bg-red-600 text-white'
			: 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'}"
	>
		<span class="min-w-0 flex-1">{toast.message}</span>
		{#if toast.action}
			{@const action = toast.action}
			<button
				type="button"
				class="-my-1 shrink-0 rounded px-2 py-1 font-semibold underline-offset-2 hover:underline"
				onclick={() => {
					toast.message = '';
					action.run();
				}}>{action.label}</button
			>
		{/if}
	</div>
{/if}
