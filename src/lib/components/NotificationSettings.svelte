<script lang="ts">
	import { onMount } from 'svelte';
	import { api } from '#lib/api.ts';
	import { ago } from '#lib/format.ts';
	import { notify } from '#lib/toast.svelte.ts';
	import type { NotifyPrefs, PushDevice } from '#lib/types.ts';

	let {
		prefs,
		devices,
		pushKey,
		multiUser
	}: {
		prefs: NotifyPrefs & { timezone: string | null };
		devices: PushDevice[];
		pushKey: string;
		/** team-only switches are hidden while you're the only user */
		multiUser: boolean;
	} = $props();

	type State = 'checking' | 'unsupported' | 'ios-install' | 'insecure' | 'denied' | 'off' | 'on';
	let status = $state<State>('checking');
	let busy = $state(false);
	const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

	const SWITCHES: { key: keyof NotifyPrefs; label: string; team?: boolean }[] = [
		{ key: 'reminders', label: '⏰ Reminders you set on issues' },
		{ key: 'digest', label: '☀️ Daily summary: due today, overdue, milestones due' },
		{ key: 'unblocked', label: '✅ An issue becomes unblocked' },
		{ key: 'comments', label: '💬 Comments on issues you created or commented on', team: true },
		{ key: 'status', label: '↻ Status changes on issues you created', team: true },
		{ key: 'prodBugs', label: '🔥 New critical / major production bugs', team: true }
	];

	async function registration() {
		// the worker is registered by SvelteKit; give it a moment on first load
		return Promise.race([
			navigator.serviceWorker.ready,
			new Promise<never>((_, reject) =>
				setTimeout(() => reject(new Error('Service worker not ready — reload and retry')), 10_000)
			)
		]);
	}

	onMount(async () => {
		const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
		const standalone = matchMedia('(display-mode: standalone)').matches;
		if (!isSecureContext) status = 'insecure';
		else if (!('serviceWorker' in navigator) || !('PushManager' in window))
			status = ios && !standalone ? 'ios-install' : 'unsupported';
		else if (Notification.permission === 'denied') status = 'denied';
		else {
			const sub = await (await registration().catch(() => null))?.pushManager.getSubscription();
			status = sub ? 'on' : 'off';
			// keep the server's timezone current (travel, DST zone changes)
			if (prefs.timezone !== timezone) api('PATCH', '/api/push/prefs', { timezone });
		}
	});

	/** VAPID public key (base64url) → bytes for pushManager.subscribe */
	function keyBytes(base64url: string) {
		const b64 = (base64url + '='.repeat((4 - (base64url.length % 4)) % 4))
			.replace(/-/g, '+')
			.replace(/_/g, '/');
		return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
	}

	function deviceName() {
		const ua = navigator.userAgent;
		const browser = /Edg\//.test(ua)
			? 'Edge'
			: /Firefox\//.test(ua)
				? 'Firefox'
				: /Chrome\//.test(ua)
					? 'Chrome'
					: /Safari\//.test(ua)
						? 'Safari'
						: 'Browser';
		const os = /iPhone|iPad/.test(ua)
			? 'iOS'
			: /Android/.test(ua)
				? 'Android'
				: /Mac OS X/.test(ua)
					? 'macOS'
					: /Windows/.test(ua)
						? 'Windows'
						: /Linux/.test(ua)
							? 'Linux'
							: '';
		const app = matchMedia('(display-mode: standalone)').matches ? ' (app)' : '';
		return `${browser}${os ? ` on ${os}` : ''}${app}`;
	}

	async function enable() {
		busy = true;
		try {
			const permission = await Notification.requestPermission();
			if (permission !== 'granted') {
				status = permission === 'denied' ? 'denied' : 'off';
				return;
			}
			const reg = await registration();
			const sub =
				(await reg.pushManager.getSubscription()) ??
				(await reg.pushManager.subscribe({
					userVisibleOnly: true,
					applicationServerKey: keyBytes(pushKey)
				}));
			await api('POST', '/api/push/subscription', {
				subscription: sub.toJSON(),
				device: deviceName(),
				timezone
			});
			status = 'on';
			notify('Notifications on for this device');
		} catch (e) {
			// usually the browser's push service: Brave and some privacy setups turn it off
			notify(
				`Couldn’t register with this browser’s push service (${(e as Error).message}). In Brave, enable “Use Google services for push messaging” in settings.`,
				true
			);
		} finally {
			busy = false;
		}
	}

	async function disable() {
		busy = true;
		try {
			const sub = await (await registration()).pushManager.getSubscription();
			if (sub) {
				await api('DELETE', '/api/push/subscription', { endpoint: sub.endpoint });
				await sub.unsubscribe();
			}
			status = 'off';
		} finally {
			busy = false;
		}
	}

	const setPref = (patch: Partial<NotifyPrefs>) =>
		api('PATCH', '/api/push/prefs', { prefs: patch, timezone });
	const test = (kind: 'test' | 'digest') =>
		api('POST', '/api/push/test', { kind }).then(() => notify('Sent — it can take a few seconds'));
</script>

<section class="overflow-x-auto">
	<h2 class="mb-1 font-semibold">Notifications</h2>
	<p class="mb-3 text-xs text-zinc-500">
		Reminders and alerts stay in the header’s notification inbox for 30 days. Enable push once per
		device to receive them outside the app too.
	</p>

	<div class="mb-3 flex flex-wrap items-center gap-2 text-sm">
		{#if status === 'checking'}
			<span class="text-zinc-400">Checking this device…</span>
		{:else if status === 'on'}
			<span class="text-green-600 dark:text-green-400">● On for this device</span>
			<button class="btn py-0.5 text-xs" onclick={() => test('test')}>Send test</button>
			<button class="btn py-0.5 text-xs" onclick={() => test('digest')}>Send today’s summary</button
			>
			<button
				class="ml-auto text-xs text-zinc-400 hover:text-red-500"
				disabled={busy}
				onclick={disable}>turn off here</button
			>
		{:else if status === 'off'}
			<button class="btn-primary" disabled={busy} onclick={enable}>Turn on for this device</button>
		{:else if status === 'denied'}
			<span class="text-amber-600 dark:text-amber-400"
				>Blocked in this browser. Allow notifications for this site in the browser’s site settings,
				then reload.</span
			>
		{:else if status === 'ios-install'}
			<span class="text-zinc-600 dark:text-zinc-300"
				>On iPhone/iPad: tap <b>Share → Add to Home Screen</b>, open the app from the home screen,
				and turn notifications on there (iOS 16.4+).</span
			>
		{:else if status === 'insecure'}
			<span class="text-amber-600 dark:text-amber-400"
				>Needs HTTPS (or localhost). Open the app over https:// to turn notifications on.</span
			>
		{:else}
			<span class="text-zinc-500">This browser doesn’t support push notifications.</span>
		{/if}
	</div>

	<p class="mb-2 text-xs text-zinc-500">
		Choose what appears in your inbox and push notifications.
	</p>
	<ul class="space-y-1.5 text-sm">
		{#each SWITCHES.filter((s) => multiUser || !s.team) as s (s.key)}
			<li class="flex flex-wrap items-center gap-2">
				<label class="flex cursor-pointer items-center gap-2">
					<input
						type="checkbox"
						checked={prefs[s.key] as boolean}
						onchange={(e) => setPref({ [s.key]: e.currentTarget.checked })}
					/>
					{s.label}
				</label>
				{#if s.key === 'digest' && prefs.digest}
					<span class="text-xs text-zinc-500">at</span>
					<input
						type="time"
						class="input py-0 text-xs"
						value={prefs.digestTime}
						onchange={(e) =>
							e.currentTarget.value && setPref({ digestTime: e.currentTarget.value })}
					/>
					<span class="text-xs text-zinc-400">{prefs.timezone ?? timezone}</span>
				{/if}
			</li>
		{/each}
	</ul>
	{#if !multiUser}
		<p class="mt-1 text-xs text-zinc-400">
			Comment, status and production-bug alerts appear once you invite someone — you’re never
			notified about your own changes.
		</p>
	{/if}

	{#if devices.length}
		<h3 class="mt-4 mb-1 text-xs font-medium text-zinc-500">Your devices</h3>
		<ul class="space-y-1 text-sm">
			{#each devices as d (d.id)}
				<li class="flex items-center gap-2">
					<span>{d.device ?? 'Unknown device'}</span>
					<span class="text-xs text-zinc-400">added {ago(d.createdAt)}</span>
					<button
						class="ml-auto text-xs text-zinc-400 hover:text-red-500"
						onclick={() => api('DELETE', '/api/push/subscription', { id: d.id })}>remove</button
					>
				</li>
			{/each}
		</ul>
	{/if}
</section>
