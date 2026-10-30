<script lang="ts">
	import { api } from '#lib/api.ts';
	import { notify } from '#lib/toast.svelte.ts';
	import { ago, fileSize } from '#lib/format.ts';
	import { APP_NAME_MAX, toAppName } from '#lib/appname.ts';
	import NotificationSettings from '#lib/components/NotificationSettings.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	let newStatus = $state('');
	let newStatusClosed = $state(false);
	let newApp = $state('');
	let newMilestone = $state({ name: '', dueDate: '' });
	async function addMilestone() {
		if (!newMilestone.name.trim()) return;
		await api('POST', '/api/milestones', newMilestone);
		newMilestone = { name: '', dueDate: '' };
	}
	const patchMilestone = (id: number, body: object) => api('PATCH', `/api/milestones/${id}`, body);

	async function addStatus() {
		if (!newStatus.trim()) return;
		await api('POST', '/api/statuses', { name: newStatus, isClosed: newStatusClosed });
		newStatus = '';
		newStatusClosed = false;
	}
	async function addApp() {
		const name = toAppName(newApp);
		if (!name) return;
		await api('POST', '/api/apps', { name });
		newApp = '';
	}
	/** Rewrites the field as you type: "Admin Panel" → "admin-panel". */
	function appNameInput(e: Event & { currentTarget: HTMLInputElement }) {
		const v = toAppName(e.currentTarget.value, true);
		e.currentTarget.value = v;
		return v;
	}
	async function renameApp(id: number, current: string, input: HTMLInputElement) {
		const name = toAppName(input.value);
		input.value = name || current;
		if (!name || name === current) return;
		await patchApp(id, { name }).catch(() => (input.value = current));
	}
	const patchStatus = (id: number, body: object) => api('PATCH', `/api/statuses/${id}`, body);
	const patchApp = (id: number, body: object) => api('PATCH', `/api/apps/${id}`, body);

	let inviteEmail = $state('');
	let inviteRole = $state<'member' | 'admin'>('member');
	let inviteUrl = $state('');
	async function invite() {
		const { url } = await api<{ url: string }>('POST', '/api/invites', {
			email: inviteEmail,
			role: inviteRole
		});
		inviteUrl = url;
		inviteEmail = '';
		copy(url);
	}
	function copy(text: string, message = 'Invite link copied') {
		navigator.clipboard?.writeText(text).then(
			() => notify(message),
			() => {}
		);
	}

	let tokenName = $state('iPhone shortcut');
	let newToken = $state('');
	async function createToken() {
		const { token } = await api<{ token: string }>('POST', '/api/tokens', { name: tokenName });
		newToken = token;
		copy(token, 'Token copied');
	}

	let backingUp = $state(false);
	async function backupNow() {
		backingUp = true;
		try {
			await api('POST', '/api/backup');
			notify('Backup saved');
		} finally {
			backingUp = false;
		}
	}

	const mcpCommand = $derived(
		`claude mcp add --scope user --transport http bugs ${data.mcpUrl} --header "Authorization: Bearer ${newToken || '<your token>'}"`
	);

	let pw = $state({ current: '', next: '' });
	async function changePassword() {
		await api('POST', '/api/account/password', pw);
		pw = { current: '', next: '' };
		notify('Password changed');
	}
</script>

<svelte:head><title>Settings · Bugs</title></svelte:head>

<div class="grid grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-2">
	<section class="overflow-x-auto">
		<h2 class="mb-1 font-semibold">Statuses</h2>
		<p class="mb-3 text-xs text-zinc-500">
			“Closed” statuses are hidden from the default Open view. New issues get the default status.
			Deleting a status moves its issues to the default.
		</p>
		<table class="w-full text-left">
			<thead class="text-xs text-zinc-500">
				<tr
					><th class="font-medium">Order</th><th class="font-medium">Name</th><th
						class="font-medium">Color</th
					><th class="font-medium">Closed</th><th class="font-medium">Default</th><th></th></tr
				>
			</thead>
			<tbody>
				{#each data.statuses as s, i (s.id)}
					<tr>
						<td class="py-1 whitespace-nowrap">
							<button
								class="px-1 text-zinc-400 hover:text-zinc-800 disabled:opacity-20 dark:hover:text-zinc-200"
								disabled={i === 0}
								onclick={() => patchStatus(s.id, { move: -1 })}>↑</button
							>
							<button
								class="px-1 text-zinc-400 hover:text-zinc-800 disabled:opacity-20 dark:hover:text-zinc-200"
								disabled={i === data.statuses.length - 1}
								onclick={() => patchStatus(s.id, { move: 1 })}>↓</button
							>
						</td>
						<td class="py-1 pr-2">
							<input
								class="input w-full"
								value={s.name}
								onchange={(e) =>
									e.currentTarget.value.trim() &&
									patchStatus(s.id, { name: e.currentTarget.value.trim() })}
							/>
						</td>
						<td
							><input
								type="color"
								value={s.color}
								onchange={(e) => patchStatus(s.id, { color: e.currentTarget.value })}
								class="h-6 w-8 cursor-pointer bg-transparent"
							/></td
						>
						<td
							><input
								type="checkbox"
								checked={s.isClosed}
								onchange={(e) => patchStatus(s.id, { isClosed: e.currentTarget.checked })}
							/></td
						>
						<td
							><input
								type="radio"
								name="default"
								checked={s.isDefault}
								onchange={() => patchStatus(s.id, { isDefault: true })}
							/></td
						>
						<td class="text-right">
							<button
								class="text-xs text-zinc-400 hover:text-red-500 disabled:opacity-20"
								disabled={s.isDefault}
								onclick={() =>
									confirm(`Delete status “${s.name}”? Its issues move to the default status.`) &&
									api('DELETE', `/api/statuses/${s.id}`)}>delete</button
							>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
		<form
			class="mt-2 flex items-center gap-2"
			onsubmit={(e) => {
				e.preventDefault();
				addStatus();
			}}
		>
			<input bind:value={newStatus} placeholder="New status" class="input flex-1" />
			<label class="flex items-center gap-1 text-xs text-zinc-500"
				><input type="checkbox" bind:checked={newStatusClosed} /> closed</label
			>
			<button class="btn">Add</button>
		</form>
	</section>

	<section class="overflow-x-auto">
		<h2 class="mb-1 font-semibold">Apps</h2>
		<p class="mb-3 text-xs text-zinc-500">
			Apps are also created automatically from <code>@name</code> in quick add. Apps with issues can be
			archived (hidden from chips and quick add) but not deleted.
		</p>
		<table class="w-full text-left">
			<thead class="text-xs text-zinc-500">
				<tr
					><th class="font-medium">Name</th><th class="font-medium">Color</th><th
						class="font-medium">Open / total</th
					><th class="font-medium">Archived</th><th></th></tr
				>
			</thead>
			<tbody>
				{#each data.apps as a (a.id)}
					<tr class={a.archived ? 'opacity-60' : ''}>
						<td class="py-1 pr-2">
							<input
								class="input w-full"
								value={a.name}
								maxlength={APP_NAME_MAX}
								oninput={appNameInput}
								onchange={(e) => renameApp(a.id, a.name, e.currentTarget)}
							/>
						</td>
						<td
							><input
								type="color"
								value={a.color}
								onchange={(e) => patchApp(a.id, { color: e.currentTarget.value })}
								class="h-6 w-8 cursor-pointer bg-transparent"
							/></td
						>
						<td class="text-zinc-500 tabular-nums"
							><a href="/?app={encodeURIComponent(a.name)}&status=all" class="hover:underline"
								>{a.openCount} / {a.totalCount}</a
							></td
						>
						<td
							><input
								type="checkbox"
								checked={a.archived}
								onchange={(e) => patchApp(a.id, { archived: e.currentTarget.checked })}
							/></td
						>
						<td class="text-right">
							<button
								class="text-xs text-zinc-400 hover:text-red-500 disabled:opacity-20"
								disabled={a.totalCount > 0}
								title={a.totalCount > 0 ? 'Has issues — archive instead' : ''}
								onclick={() =>
									confirm(`Delete app “${a.name}”?`) && api('DELETE', `/api/apps/${a.id}`)}
								>delete</button
							>
						</td>
					</tr>
				{:else}
					<tr><td colspan="5" class="py-4 text-zinc-400">No apps yet.</td></tr>
				{/each}
			</tbody>
		</table>
		<form
			class="mt-2 flex gap-2"
			onsubmit={(e) => {
				e.preventDefault();
				addApp();
			}}
		>
			<input
				value={newApp}
				oninput={(e) => (newApp = appNameInput(e))}
				maxlength={APP_NAME_MAX}
				placeholder="new-app (lowercase, no spaces)"
				class="input flex-1"
			/>
			<button class="btn">Add</button>
		</form>
	</section>

	<section class="overflow-x-auto">
		<h2 id="milestones" class="mb-1 font-semibold">Milestones</h2>
		<p class="mb-3 text-xs text-zinc-500">
			Target releases. Also created from <code>^name</code> in quick add. Marking one done hides it from
			pickers; deleting one keeps its issues, just without a milestone.
		</p>
		<table class="w-full text-left">
			<thead class="text-xs text-zinc-500">
				<tr>
					<th class="font-medium">Name</th>
					<th class="font-medium">Due</th>
					<th class="font-medium">Open / total</th>
					<th class="font-medium">Done</th>
					<th></th>
				</tr>
			</thead>
			<tbody>
				{#each data.milestones as m (m.id)}
					<tr class={m.done ? 'opacity-60' : ''}>
						<td class="py-1 pr-2">
							<input
								class="input w-full"
								value={m.name}
								onchange={(e) =>
									e.currentTarget.value.trim()
										? patchMilestone(m.id, { name: e.currentTarget.value })
										: (e.currentTarget.value = m.name)}
							/>
						</td>
						<td class="pr-2">
							<input
								type="date"
								class="input"
								value={m.dueDate ?? ''}
								onchange={(e) => patchMilestone(m.id, { dueDate: e.currentTarget.value })}
							/>
						</td>
						<td class="text-zinc-500 tabular-nums"
							><a href="/?ms={m.id}&status=all" class="hover:underline"
								>{m.openCount} / {m.totalCount}</a
							></td
						>
						<td
							><input
								type="checkbox"
								checked={m.done}
								onchange={(e) => patchMilestone(m.id, { done: e.currentTarget.checked })}
							/></td
						>
						<td class="text-right">
							<a href="/milestones/{m.id}" class="mr-3 text-xs text-zinc-500 hover:underline"
								>Hill Chart →</a
							>
							<button
								class="text-xs text-zinc-400 hover:text-red-500"
								onclick={() =>
									confirm(
										`Delete milestone “${m.name}”?${m.totalCount ? ` Its ${m.totalCount} issue(s) stay, without a milestone.` : ''}`
									) && api('DELETE', `/api/milestones/${m.id}`)}>delete</button
							>
						</td>
					</tr>
				{:else}
					<tr><td colspan="5" class="py-4 text-zinc-400">No milestones yet.</td></tr>
				{/each}
			</tbody>
		</table>
		<form
			class="mt-2 flex gap-2"
			onsubmit={(e) => {
				e.preventDefault();
				addMilestone();
			}}
		>
			<input bind:value={newMilestone.name} placeholder="v1.3" class="input min-w-0 flex-1" />
			<input bind:value={newMilestone.dueDate} type="date" class="input" title="Due (optional)" />
			<button class="btn">Add</button>
		</form>
	</section>
</div>

<div class="mt-10 grid grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-2">
	{#if data.user?.role === 'admin'}
		<section class="overflow-x-auto">
			<h2 class="mb-1 font-semibold">Users</h2>
			<p class="mb-3 text-xs text-zinc-500">
				Invite people with a link (valid 7 days, single use). Admins can manage users; everyone can
				edit issues, statuses and apps.
			</p>
			<table class="w-full text-left">
				<thead class="text-xs text-zinc-500">
					<tr>
						<th class="font-medium">Name</th>
						<th class="font-medium">Email</th>
						<th class="font-medium">Role</th>
						<th></th>
					</tr>
				</thead>
				<tbody>
					{#each data.users as u (u.id)}
						<tr>
							<td class="py-1 pr-2">{u.name}</td>
							<td class="pr-2 text-zinc-500">{u.email}</td>
							<td>
								{#if u.id === data.user.id}
									<span class="text-zinc-500">{u.role} (you)</span>
								{:else}
									<select
										class="cell-select"
										value={u.role}
										onchange={(e) =>
											api('PATCH', `/api/users/${u.id}`, { role: e.currentTarget.value })}
									>
										<option value="member">member</option>
										<option value="admin">admin</option>
									</select>
								{/if}
							</td>
							<td class="text-right">
								{#if u.id !== data.user.id}
									<button
										class="text-xs text-zinc-400 hover:text-red-500"
										onclick={() =>
											confirm(
												`Remove ${u.name}? Their comments and history stay, without a name.`
											) && api('DELETE', `/api/users/${u.id}`)}>remove</button
									>
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>

			<form
				class="mt-3 flex flex-wrap items-center gap-2"
				onsubmit={(e) => {
					e.preventDefault();
					invite();
				}}
			>
				<input
					bind:value={inviteEmail}
					type="email"
					placeholder="Email (optional — locks the invite to it)"
					class="input min-w-0 flex-1"
				/>
				<select bind:value={inviteRole} class="input">
					<option value="member">member</option>
					<option value="admin">admin</option>
				</select>
				<button class="btn">Create invite link</button>
			</form>
			{#if inviteUrl}
				<div class="mt-2 flex items-center gap-2">
					<input
						readonly
						value={inviteUrl}
						class="input min-w-0 flex-1 text-xs"
						onfocus={(e) => e.currentTarget.select()}
					/>
					<button class="btn" onclick={() => copy(inviteUrl)}>Copy</button>
				</div>
				<p class="mt-1 text-xs text-zinc-500">
					The link is only shown once — send it to the person now.
				</p>
			{/if}

			{#if data.invites.length}
				<h3 class="mt-4 mb-1 text-xs font-medium text-zinc-500">Pending invites</h3>
				<ul class="space-y-1 text-sm">
					{#each data.invites as inv (inv.id)}
						<li class="flex items-center gap-2">
							<span>{inv.email ?? 'anyone with the link'}</span>
							<span class="text-xs text-zinc-400">{inv.role} · expires {ago(inv.expiresAt)}</span>
							<button
								class="ml-auto text-xs text-zinc-400 hover:text-red-500"
								onclick={() => api('DELETE', `/api/invites/${inv.id}`)}>revoke</button
							>
						</li>
					{/each}
				</ul>
			{/if}
		</section>
	{/if}

	{#if data.backup}
		<section class="overflow-x-auto">
			<h2 class="mb-1 font-semibold">Backups</h2>
			{#if data.backup.enabled}
				<p class="mb-3 text-xs text-zinc-500">
					A <code>pg_dump</code> goes to the attachments bucket every night (UTC), under
					<code>backups/</code>. Restore with
					<code>pg_restore --clean --if-exists --no-owner -d "$DATABASE_URL" file.dump</code>.
				</p>
				<p class="mb-2 text-sm">
					{#if data.backup.last}
						Last backup {ago(new Date(data.backup.last.at))} ·
						{fileSize(data.backup.last.size)} ·
						<code class="text-xs">{data.backup.last.key}</code>
					{:else}
						No backup yet.
					{/if}
				</p>
				{#if data.backup.error}
					<p class="mb-2 text-sm text-red-600 dark:text-red-400">
						Last attempt failed: {data.backup.error}
					</p>
				{/if}
				<button class="btn" disabled={backingUp} onclick={backupNow}
					>{backingUp ? 'Backing up…' : 'Back up now'}</button
				>
			{:else}
				<p class="text-xs text-zinc-500">
					Off: backups need S3 configured, and <code>BACKUP_KEEP_DAYS</code> above 0.
				</p>
			{/if}
		</section>
	{/if}

	<section class="overflow-x-auto">
		<h2 class="mb-1 font-semibold">Account</h2>
		<p class="mb-3 text-xs text-zinc-500">Signed in as {data.user?.name} ({data.user?.email}).</p>
		<form
			class="flex max-w-sm flex-col gap-2"
			onsubmit={(e) => {
				e.preventDefault();
				changePassword();
			}}
		>
			<input
				bind:value={pw.current}
				type="password"
				placeholder="Current password"
				required
				class="input"
				autocomplete="current-password"
			/>
			<input
				bind:value={pw.next}
				type="password"
				placeholder="New password (min 8)"
				required
				minlength="8"
				class="input"
				autocomplete="new-password"
			/>
			<button class="btn self-start">Change password</button>
		</form>
	</section>

	<NotificationSettings
		prefs={data.notify}
		devices={data.devices}
		pushKey={data.pushKey}
		multiUser={data.user?.role !== 'admin' || data.users.length > 1}
	/>

	<section class="overflow-x-auto lg:col-span-2">
		<h2 class="mb-1 font-semibold">API tokens & iPhone shortcut</h2>
		<p class="mb-3 text-xs text-zinc-500">
			A token lets scripts and the iOS Share sheet add issues as you. It is shown once; only a hash
			is stored. Revoke it any time.
		</p>
		{#if data.tokens.length}
			<ul class="mb-3 space-y-1 text-sm">
				{#each data.tokens as t (t.id)}
					<li class="flex items-center gap-2">
						<span>{t.name}</span>
						<span class="text-xs text-zinc-400"
							>created {ago(t.createdAt)} · {t.lastUsedAt
								? `last used ${ago(t.lastUsedAt)}`
								: 'never used'}</span
						>
						<button
							class="ml-auto text-xs text-zinc-400 hover:text-red-500"
							onclick={() =>
								confirm(`Revoke “${t.name}”? Anything using it stops working.`) &&
								api('DELETE', `/api/tokens/${t.id}`)}>revoke</button
						>
					</li>
				{/each}
			</ul>
		{/if}
		<form
			class="flex max-w-lg gap-2"
			onsubmit={(e) => {
				e.preventDefault();
				createToken();
			}}
		>
			<input bind:value={tokenName} placeholder="Token name" class="input min-w-0 flex-1" />
			<button class="btn">Create token</button>
		</form>
		{#if newToken}
			<div class="mt-2 flex max-w-lg items-center gap-2">
				<input
					readonly
					value={newToken}
					class="input min-w-0 flex-1 text-xs"
					onfocus={(e) => e.currentTarget.select()}
				/>
				<button class="btn" onclick={() => copy(newToken, 'Token copied')}>Copy</button>
			</div>
			<p class="mt-1 text-xs text-zinc-500">Shown only now. Paste it into the shortcut below.</p>
		{/if}

		<details class="mt-4 max-w-3xl text-sm">
			<summary class="cursor-pointer font-medium"
				>Set up “Add bug” in the iPhone Share sheet</summary
			>
			<ol class="mt-2 list-decimal space-y-1.5 pl-5 text-zinc-700 dark:text-zinc-300">
				<li>Create a token above and copy it (AirDrop or Notes it to your phone).</li>
				<li>
					On the iPhone open <b>Shortcuts</b> → <b>+</b> → name it <b>Add bug</b>. Tap the
					<b>ⓘ</b> (or the name) → turn on <b>Show in Share Sheet</b>, and set it to receive
					<b>Images</b>, <b>Text</b> and <b>URLs</b>. Set “If there’s no input” to <b>Continue</b>.
				</li>
				<li>
					Add <b>Ask for Input</b> → type <b>Text</b>, prompt “What’s the bug?”. You can type the
					same syntax as quick add: <code>@app !high ^v1.3 *fri</code>.
				</li>
				<li>
					Add <b>Base64 Encode</b> → input <b>Shortcut Input</b>, line breaks <b>None</b>.
				</li>
				<li>
					Add <b>Get Contents of URL</b>:
					<ul class="mt-1 list-disc space-y-0.5 pl-5">
						<li>
							URL: <code class="select-all">{data.captureUrl}</code>
							<button
								class="ml-1 text-xs text-zinc-400 hover:underline"
								onclick={() => copy(data.captureUrl, 'URL copied')}>copy</button
							>
						</li>
						<li>Method: <b>POST</b></li>
						<li>
							Headers: <code>Authorization</code> = <code>Bearer &lt;your token&gt;</code>
						</li>
						<li>
							Request Body: <b>JSON</b> with <code>text</code> = <b>Provided Input</b> and
							<code>content</code> = <b>Base64 Encoded</b>
						</li>
					</ul>
				</li>
				<li>
					Add <b>Get Dictionary Value</b> → key <code>message</code>, then <b>Show Notification</b>
					with that value (it says e.g. “Added #42”).
				</li>
			</ol>
			<p class="mt-2 text-xs text-zinc-500">
				Use it from Photos or a screenshot (attached as an image), Safari (the page becomes a link
				on the issue) or any text. Without <code>@app</code> it goes to Inbox. Leave the question
				empty and a screenshot gets a dated title. The phone must be able to reach
				<code>{data.captureUrl}</code>; if you only run this on your laptop or LAN, the shortcut
				works only on that network.
			</p>
		</details>

		<details class="mt-3 max-w-3xl text-sm">
			<summary class="cursor-pointer font-medium">Use it from Claude Code (MCP)</summary>
			<p class="mt-2 text-zinc-700 dark:text-zinc-300">
				Claude Code can then list, read, create, comment on and close issues from any project.
				Reading an issue includes its comments, history and attachments: screenshots come through as
				images and logs as text, so “find the root cause of #123” needs no copy-pasting. Run once
				(create a token above first):
			</p>
			<pre
				class="mt-2 overflow-x-auto rounded bg-zinc-100 p-2.5 text-xs whitespace-pre-wrap dark:bg-zinc-900">{mcpCommand}</pre>
			<button
				class="mt-1 text-xs text-zinc-400 hover:underline"
				onclick={() => copy(mcpCommand, 'Command copied')}>copy</button
			>
		</details>

		<details class="mt-3 max-w-3xl text-sm">
			<summary class="cursor-pointer font-medium">Use it from a terminal</summary>
			<pre
				class="mt-2 overflow-x-auto rounded bg-zinc-100 p-2.5 text-xs dark:bg-zinc-900">curl -s {data.captureUrl} \
  -H "Authorization: Bearer $BUGS_TOKEN" \
  -H "content-type: application/json" \
  -d '{JSON.stringify({ text: 'checkout crash on safari @shop !high *fri' })}'</pre>
		</details>
	</section>
</div>
