<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { afterNavigate } from '$app/navigation';
	import { ago } from '#lib/format.ts';
	import type { InboxNotification } from '#lib/types.ts';

	let { initialUnread }: { initialUnread: number } = $props();
	type Item = Omit<InboxNotification, 'createdAt' | 'readAt'> & {
		createdAt: string;
		readAt: string | null;
	};
	let unread = $derived(initialUnread);
	let open = $state(false);
	let items = $state<Item[]>([]);
	let nextCursor = $state<number | null>(null);
	let loading = $state(false);
	let saving = $state(false);
	let loaded = $state(false);
	let message = $state('');
	let root: HTMLDivElement;
	let trigger: HTMLButtonElement;
	let panel = $state<HTMLDivElement>();
	let revision = 0;
	let disposed = false;
	let writes = Promise.resolve();
	let pendingWrites = 0;

	afterNavigate(() => {
		open = false;
	});

	async function responseData(response: Response) {
		if (!response.ok) throw new Error('Couldn’t update notifications. Try again.');
		return response.json();
	}

	async function load(before: number | null = null, countOnly = false) {
		if (saving || (loading && (before !== null || countOnly))) return;
		const request = ++revision;
		loading = true;
		try {
			const query = countOnly ? '?count=1' : before ? `?before=${before}` : '';
			const data = await responseData(
				await fetch(`/api/notifications${query}`, { cache: 'no-store' })
			);
			if (disposed || request !== revision) return;
			unread = data.unreadCount;
			if (!countOnly) {
				const incoming = data.items as Item[];
				if (before) {
					const ids = new Set(items.map((item) => item.id));
					items = [...items, ...incoming.filter((item) => !ids.has(item.id))];
					nextCursor = data.nextCursor;
				} else {
					// Keep previously loaded older pages while refreshing the newest entries.
					const oldest = incoming.at(-1)?.id;
					const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
					const older =
						oldest === undefined
							? []
							: items.filter(
									(item) => item.id < oldest && new Date(item.createdAt).getTime() >= cutoff
								);
					items = [...incoming, ...older];
					if (!older.length) nextCursor = data.nextCursor;
				}
				loaded = true;
				message = '';
			}
		} catch (error) {
			if (!disposed && request === revision && !countOnly) message = (error as Error).message;
		} finally {
			if (request === revision) loading = false;
		}
	}

	function markRead(body: { id: number } | { through: number }) {
		++revision; // Ignore an older poll that could otherwise restore a stale unread count.
		loading = false;
		++pendingWrites;
		saving = true;
		// Keep rapid clicks on different notifications without racing their unread counts.
		writes = writes.then(() => writeRead(body));
		return writes;
	}

	async function writeRead(body: { id: number } | { through: number }) {
		message = '';
		try {
			const data = await responseData(
				await fetch('/api/notifications', {
					method: 'PATCH',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify(body),
					keepalive: true
				})
			);
			if (disposed) return;
			const now = new Date().toISOString();
			items = items.map((item) =>
				('id' in body ? item.id === body.id : item.id <= body.through)
					? { ...item, readAt: item.readAt ?? now }
					: item
			);
			unread = data.unreadCount;
		} catch (error) {
			if (!disposed) message = (error as Error).message;
		} finally {
			--pendingWrites;
			saving = pendingWrites > 0;
		}
	}

	async function toggle() {
		open = !open;
		if (open) {
			void load();
			await tick();
			panel?.focus();
		}
	}

	function close(restoreFocus = false) {
		open = false;
		if (restoreFocus) trigger?.focus();
	}

	onMount(() => {
		disposed = false;
		const refresh = () => {
			if (document.visibilityState === 'visible') void load(null, !open);
		};
		const outside = (event: PointerEvent) => {
			if (open && !root.contains(event.target as Node)) close();
		};
		const focusOutside = (event: FocusEvent) => {
			if (open && !root.contains(event.target as Node)) close();
		};
		// The daily summary needs a local timezone even when push is turned off.
		void fetch('/api/push/prefs', {
			method: 'PATCH',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ timezone: Intl.DateTimeFormat().resolvedOptions().timeZone })
		}).catch(() => {});
		refresh();
		const timer = setInterval(refresh, 30_000);
		window.addEventListener('focus', refresh);
		document.addEventListener('visibilitychange', refresh);
		document.addEventListener('pointerdown', outside);
		document.addEventListener('focusin', focusOutside);
		return () => {
			disposed = true;
			++revision;
			clearInterval(timer);
			window.removeEventListener('focus', refresh);
			document.removeEventListener('visibilitychange', refresh);
			document.removeEventListener('pointerdown', outside);
			document.removeEventListener('focusin', focusOutside);
		};
	});
</script>

<div class="relative shrink-0" bind:this={root}>
	<button
		bind:this={trigger}
		type="button"
		class="relative flex h-8 w-8 items-center justify-center rounded text-zinc-500 hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-blue-500 dark:hover:bg-zinc-800"
		aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
		aria-expanded={open}
		aria-haspopup="dialog"
		aria-controls="notification-inbox"
		title="Notifications"
		onclick={toggle}
	>
		<svg
			width="20"
			height="20"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="1.7"
			stroke-linecap="round"
			stroke-linejoin="round"
			aria-hidden="true"
		>
			<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
			<path d="M10 21h4" />
		</svg>
		{#if unread > 0}
			<span
				class="absolute -top-1 -right-1 min-w-4 rounded-full bg-red-600 px-1 text-center text-[10px] leading-4 font-semibold text-white"
				aria-hidden="true">{unread > 99 ? '99+' : unread}</span
			>
		{/if}
	</button>
	{#if open}
		<div
			bind:this={panel}
			id="notification-inbox"
			role="dialog"
			aria-label="Notifications"
			tabindex="-1"
			class="fixed top-14 right-2 left-2 z-50 overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-xl outline-none sm:absolute sm:top-full sm:right-0 sm:left-auto sm:mt-2 sm:w-96 dark:border-zinc-800 dark:bg-zinc-950"
			onkeydown={(event) => {
				if (event.key === 'Escape') {
					event.preventDefault();
					close(true);
				}
				if (event.key !== 'Tab') event.stopPropagation();
			}}
		>
			<div
				class="flex items-center justify-between gap-2 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800"
			>
				<div>
					<h2 class="text-sm font-semibold">Notifications</h2>
					<p class="mt-0.5 text-xs text-zinc-500">Last 30 days · {unread} unread</p>
				</div>
				<div class="flex items-center gap-2">
					<button
						type="button"
						class="text-xs text-blue-600 disabled:opacity-40 dark:text-blue-400"
						disabled={!unread || !items.length || saving || loading}
						onclick={() => markRead({ through: items[0].id })}>Mark all as read</button
					>
					<button
						type="button"
						class="rounded px-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
						aria-label="Close notifications"
						onclick={() => close(true)}>✕</button
					>
				</div>
			</div>
			{#if message}
				<div
					role="alert"
					class="flex items-center justify-between gap-2 px-4 py-3 text-xs text-red-600 dark:text-red-400"
				>
					<span>{message}</span>
					<button type="button" class="underline" disabled={loading} onclick={() => load()}
						>Retry</button
					>
				</div>
			{/if}
			<div class="max-h-[min(65vh,32rem)] overflow-y-auto overscroll-contain" aria-busy={loading}>
				{#if !loaded && loading}
					<p role="status" class="px-4 py-10 text-center text-sm text-zinc-500">
						Loading notifications…
					</p>
				{:else if loaded && !items.length}
					<div class="px-6 py-10 text-center">
						<p class="text-sm font-medium">You’re all caught up</p>
						<p class="mt-1 text-xs text-zinc-500">
							Reminders and alerts will appear here, even with push turned off.
						</p>
					</div>
				{:else}
					<ul class="divide-y divide-zinc-100 dark:divide-zinc-800">
						{#each items as item (item.id)}
							<li>
								<a
									href={item.url}
									class="flex gap-3 px-4 py-3 hover:bg-zinc-100 focus-visible:bg-zinc-100 dark:hover:bg-zinc-800 dark:focus-visible:bg-zinc-800 {item.readAt
										? ''
										: 'bg-blue-50/60 dark:bg-blue-950/20'}"
									onclick={() => {
										if (!item.readAt) void markRead({ id: item.id });
										close();
									}}
								>
									<span
										class="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full {item.readAt
											? 'bg-transparent'
											: 'bg-blue-500'}"
										aria-label={item.readAt ? 'Read' : 'Unread'}
									></span>
									<div class="min-w-0">
										<p
											class="text-sm break-words {item.readAt
												? 'text-zinc-600 dark:text-zinc-400'
												: 'font-medium'}"
										>
											{item.title}
										</p>
										<p class="mt-1 text-xs break-words text-zinc-500">{item.body}</p>
										<time
											class="mt-1 block text-[11px] text-zinc-400"
											datetime={item.createdAt}
											title={new Date(item.createdAt).toLocaleString()}
											>{ago(new Date(item.createdAt))}</time
										>
									</div>
								</a>
							</li>
						{/each}
					</ul>
				{/if}
				{#if nextCursor !== null}
					<button
						type="button"
						class="w-full px-4 py-3 text-xs text-blue-600 hover:bg-zinc-50 disabled:opacity-40 dark:text-blue-400 dark:hover:bg-zinc-900"
						disabled={loading || saving}
						onclick={() => load(nextCursor)}
						>{loading ? 'Loading…' : 'Load older notifications'}</button
					>
				{/if}
			</div>
		</div>
	{/if}
</div>
