<script lang="ts">
	import { onMount, tick, untrack } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { goto } from '$app/navigation';
	import { api, filesFrom, upload } from '#lib/api.ts';
	import { guardUnsaved } from '#lib/unsaved.ts';
	import { nav } from '#lib/nav.svelte.ts';
	import { notify } from '#lib/toast.svelte.ts';
	import {
		ago,
		ENV_CLASS,
		fileSize,
		fullDate,
		PRIORITY_CLASS,
		SEVERITY_CLASS,
		TYPE_CLASS
	} from '#lib/format.ts';
	import {
		ENVIRONMENTS,
		PRIORITIES,
		RELATION_KINDS,
		REPEATS,
		SEVERITIES,
		SIZES,
		TYPES,
		TYPE_LABEL,
		type IssueEvent,
		type IssuePatch,
		type RelationKind
	} from '#lib/types.ts';
	import Markdown from '#lib/components/Markdown.svelte';
	import MediaViewer from '#lib/components/MediaViewer.svelte';
	import TodayToggle from '#lib/components/TodayToggle.svelte';
	import ResumeNote from '#lib/components/ResumeNote.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const issue = $derived(data.issue);
	const status = $derived(data.statuses.find((s) => s.id === issue.statusId));

	// local drafts. Every save refreshes the whole issue, so a draft only takes the server
	// copy when that field changed and the draft wasn't edited (or on another issue) —
	// changing status mid-description must not wipe what you're typing.
	const serverDrafts = () => ({
		id: issue.id,
		title: issue.title,
		description: issue.description,
		labels: issue.labels.join(' ')
	});
	let previous = untrack(serverDrafts);
	let title = $state(previous.title);
	let description = $state(previous.description);
	let labels = $state(previous.labels);
	$effect.pre(() => {
		const incoming = serverDrafts();
		untrack(() => {
			const other = incoming.id !== previous.id;
			if (other || title === previous.title) title = incoming.title;
			if (other || description === previous.description) description = incoming.description;
			if (other || labels === previous.labels) labels = incoming.labels;
			previous = incoming;
		});
	});
	let comment = $state('');

	const save = (patch: IssuePatch) => api('PATCH', `/api/issues/${issue.id}`, patch);

	// values already handed to save(); blur saves before a link click navigates,
	// so these count as saved even though the refreshed issue hasn't arrived yet
	const sent = { title: '', description: '' };

	function saveTitle() {
		title = title.trim() || title;
		sent.title = title;
		if (title.trim() && title !== issue.title) save({ title });
		else title = issue.title;
	}
	function saveDescription() {
		sent.description = description;
		if (description !== issue.description) save({ description }).then(() => notify('Saved'));
	}

	// description shows rendered Markdown; click, `e` or Edit switches to the textarea
	let editing = $state(false);
	let descriptionInput = $state<HTMLTextAreaElement>();
	async function editDescription() {
		editing = true;
		await tick();
		descriptionInput?.focus();
	}
	function finishDescription() {
		saveDescription();
		editing = false;
	}
	function onRenderedClick(e: MouseEvent) {
		// let links work and text be selected without flipping into edit mode
		if ((e.target as HTMLElement).closest('a, input') || getSelection()?.toString()) return;
		editDescription();
	}
	function saveLabels() {
		const next = labels
			.split(/[\s,]+/)
			.map((l) => l.replace(/^\+/, ''))
			.filter(Boolean);
		if (next.join(' ') !== issue.labels.join(' ')) save({ labels: next });
	}
	async function addComment() {
		const body = comment;
		if (!body.trim()) return;
		// clear right away so you can keep typing; put it back if the post fails
		comment = '';
		await api('POST', `/api/issues/${issue.id}/comments`, { body }).catch(() => {
			comment = comment.trim() ? `${body}\n\n${comment}` : body;
		});
	}
	const statusById = $derived(new Map(data.statuses.map((s) => [s.id, s])));
	const relationLabel = (kind: RelationKind) => RELATION_KINDS.find((k) => k.value === kind)?.label;
	const issueNumber = (v: string) => {
		const n = Number(v.trim().replace(/^#/, ''));
		return Number.isInteger(n) && n > 0 ? n : null;
	};

	// the "+ Subtask · + Link · + Related" bar opens one inline form at a time
	let adding = $state<'subtask' | 'link' | 'relation' | null>(null);
	const toggleAdding = (what: typeof adding) => (adding = adding === what ? null : what);
	const closeOnEscape = (e: KeyboardEvent) => {
		if (e.key === 'Escape') {
			e.stopPropagation();
			adding = null;
		}
	};
	const focus = (el: HTMLElement) => el.focus();
	// sidebar: empty values read as a faint "—"
	const faint = (empty: boolean) => (empty ? 'text-zinc-400 dark:text-zinc-600' : '');

	let newSubtask = $state('');
	async function addSubtask() {
		const title = newSubtask.trim();
		if (!title) return;
		newSubtask = '';
		await api('POST', '/api/issues', {
			items: [
				{
					title,
					apps: issue.appId === null ? [] : [issue.appName],
					type: 'task',
					parentId: issue.id,
					milestone: issue.milestoneName ?? undefined
				}
			]
		}).catch(() => {
			if (!newSubtask.trim()) newSubtask = title;
		});
	}

	let newLink = $state({ url: '', title: '' });
	async function addLink() {
		const link = newLink;
		if (!link.url.trim()) return;
		newLink = { url: '', title: '' };
		adding = null;
		await api('POST', `/api/issues/${issue.id}/links`, link).catch(() => {
			if (!newLink.url.trim()) newLink = link;
			adding ??= 'link';
		});
	}
	const linkText = (url: string) => {
		const u = new URL(url);
		return (u.host + u.pathname).replace(/\/$/, '');
	};

	let relKind = $state<RelationKind>('relates');
	let relTarget = $state('');
	async function addRelation() {
		const otherId = issueNumber(relTarget);
		if (!otherId) return notify('Enter an issue number, e.g. #12', true);
		const target = relTarget;
		relTarget = '';
		adding = null;
		await api('POST', `/api/issues/${issue.id}/relations`, { kind: relKind, otherId }).catch(() => {
			if (!relTarget.trim()) relTarget = target;
			adding ??= 'relation';
		});
	}

	function setParent(input: HTMLInputElement) {
		const parentId = input.value.trim() ? issueNumber(input.value) : null;
		if (input.value.trim() && !parentId) {
			input.value = issue.parentId ? `#${issue.parentId}` : '';
			return notify('Enter an issue number, e.g. #12', true);
		}
		if (parentId !== issue.parentId)
			save({ parentId }).catch(() => (input.value = issue.parentId ? `#${issue.parentId}` : ''));
	}

	async function chooseMilestone(select: HTMLSelectElement) {
		if (select.value !== 'new')
			return save({ milestoneId: select.value ? Number(select.value) : null });
		select.value = String(issue.milestoneId ?? '');
		const name = prompt('New milestone name, e.g. v1.3')?.trim();
		if (!name) return;
		const { id } = await api<{ id: number }>('POST', '/api/milestones', { name });
		await save({ milestoneId: id });
	}

	// activity: a run of field changes by one person within 10 minutes folds into one line
	const GROUP_MS = 10 * 60_000;
	type ActivityItem =
		{ kind: 'comment'; ev: IssueEvent } | { kind: 'changes'; key: number; events: IssueEvent[] };
	const activity = $derived.by(() => {
		const out: ActivityItem[] = [];
		for (const ev of data.events) {
			const last = out.at(-1);
			if (ev.kind === 'comment') out.push({ kind: 'comment', ev });
			else if (
				last?.kind === 'changes' &&
				last.events[0].userId === ev.userId &&
				ev.createdAt.getTime() - last.events.at(-1)!.createdAt.getTime() < GROUP_MS
			)
				last.events.push(ev);
			else out.push({ kind: 'changes', key: ev.id, events: [ev] });
		}
		return out;
	});
	const FIELD_SUMMARY: Record<string, string> = {
		attachment: 'attachments',
		link: 'links',
		relation: 'related issues'
	};
	const changedFields = (events: IssueEvent[]) =>
		[...new Set(events.map((e) => FIELD_SUMMARY[e.field ?? ''] ?? e.field))].join(', ');
	const expanded = new SvelteSet<number>();
	const hasComments = $derived(data.events.some((e) => e.kind === 'comment'));

	// remembered per browser
	let commentsOnly = $state(false);
	function setCommentsOnly(on: boolean) {
		commentsOnly = on;
		try {
			localStorage.setItem('issue.commentsOnly', on ? '1' : '');
		} catch {
			// storage blocked: lasts until reload
		}
	}

	let menu = $state<HTMLDetailsElement>();
	function copyLink() {
		if (menu) menu.open = false;
		navigator.clipboard?.writeText(location.href).then(
			() => notify('Link copied'),
			() => notify('Could not copy the link', true)
		);
	}
	let idCopied = $state(false);
	function copyId() {
		if (menu) menu.open = false;
		navigator.clipboard?.writeText(`#${issue.id}`).then(
			() => {
				notify(`Copied #${issue.id}`);
				idCopied = true;
				setTimeout(() => (idCopied = false), 1500);
			},
			() => notify('Could not copy the ID', true)
		);
	}

	// "remind me": presets are local times; the server sends a push notification then
	let pickingReminder = $state(false);
	const at = (days: number, hour: number) => {
		const now = new Date(Date.now());
		return new Date(now.getFullYear(), now.getMonth(), now.getDate() + days, hour);
	};
	const REMINDER_PRESETS: { label: string; at: () => Date }[] = [
		{ label: 'In 1 hour', at: () => new Date(Date.now() + 3600_000) },
		{ label: 'This evening (18:00)', at: () => at(0, 18) },
		{ label: 'Tomorrow 09:00', at: () => at(1, 9) },
		{ label: 'Next Monday 09:00', at: () => at((8 - new Date().getDay()) % 7 || 7, 9) }
	];
	const reminderText = (d: Date) =>
		d.toLocaleString(undefined, {
			weekday: 'short',
			day: 'numeric',
			month: 'short',
			hour: '2-digit',
			minute: '2-digit'
		});
	async function setReminder(when: Date | null) {
		pickingReminder = false;
		if (when && when.getTime() <= Date.now()) return notify('Pick a time in the future', true);
		await save({ remindAt: when ? when.toISOString() : null });
		notify(when ? `Reminder set for ${reminderText(when)}` : 'Reminder removed');
	}

	async function remove() {
		if (menu) menu.open = false;
		if (
			!confirm(
				`Move #${issue.id} and its active subtasks to Trash? You can restore them for 30 days.`
			)
		)
			return;
		await api('DELETE', `/api/issues/${issue.id}`);
		notify('Moved to Trash · recover within 30 days');
		goto(nav.listUrl);
	}
	let resumeOpen = $state(false);
	// Collapse the resume note when navigating to another issue (not on every data refresh).
	const issueId = $derived(issue.id);
	$effect(() => {
		void issueId;
		resumeOpen = false;
	});
	let uploading = $state(0);
	let dragging = $state(false);
	let picker = $state<HTMLInputElement>();
	let viewing = $state<number | null>(null);

	guardUnsaved(
		() =>
			(description !== issue.description && description !== sent.description) ||
			(!!title.trim() && title !== issue.title && title !== sent.title) ||
			!!comment.trim() ||
			!!newSubtask.trim() ||
			!!newLink.url.trim() ||
			uploading > 0
	);

	const isMedia = (mime: string) => mime.startsWith('image/') || mime.startsWith('video/');
	const media = $derived(data.attachments.filter((f) => isMedia(f.mime)));

	async function attach(files: File[]) {
		if (!files.length) return;
		if (!data.attachmentsEnabled) return notify('Attachments need S3 — see README', true);
		uploading = files.length;
		try {
			await upload(issue.id, files);
			notify(files.length === 1 ? `Attached ${files[0].name}` : `Attached ${files.length} files`);
		} finally {
			uploading = 0;
		}
	}
	function removeAttachment(id: number, name: string) {
		if (confirm(`Delete ${name}?`))
			api('DELETE', `/api/issues/${issue.id}/attachments`, { attachmentId: id });
	}

	function ctrlEnter(fn: () => void) {
		return (e: KeyboardEvent) => {
			if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
				e.preventDefault();
				fn();
			}
		};
	}

	// single-key shortcuts; `?` lists them. Elements tagged data-key="…" are focused,
	// opened (selects) or clicked (buttons). Runs before the layout's n/m handler.
	let showShortcuts = $state(false);
	const SHORTCUTS: [string, string][] = [
		['e', 'Edit description'],
		['E', 'Edit title'],
		['r', 'Resume note'],
		['c', 'Write a comment'],
		['s', 'Status'],
		['p', 'Priority'],
		['t', 'Type'],
		['m', 'Milestone'],
		['d', 'Due date'],
		['l', 'Labels'],
		['S', 'Add subtask'],
		['L', 'Add link'],
		['R', 'Add related issue'],
		['a', 'Attach files'],
		['*', 'Toggle Today'],
		['i', 'Copy issue ID'],
		['y', 'Copy link'],
		['n', 'New issue'],
		['Ctrl+K', 'Search / commands'],
		['?', 'Show shortcuts'],
		['Esc', 'Back to issues']
	];
	function runShortcut(key: string): boolean {
		switch (key) {
			case 'e':
				editDescription();
				return true;
			case 'r':
				resumeOpen = true;
				document.getElementById('resume-stopped')?.focus();
				return true;
			case 'S':
				if (issue.parentId) return false;
				adding = 'subtask';
				return true;
			case 'L':
				adding = 'link';
				return true;
			case 'R':
				adding = 'relation';
				return true;
			case 'a':
				picker?.click();
				return !!picker;
			case 'i':
				copyId();
				return true;
			case 'y':
				copyLink();
				return true;
			case '?':
				showShortcuts = true;
				return true;
		}
		const el = document.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`);
		if (!el || (el as HTMLInputElement).disabled) return false;
		if (el instanceof HTMLButtonElement) {
			el.click();
			return true;
		}
		el.focus();
		if (el instanceof HTMLSelectElement) {
			try {
				el.showPicker();
			} catch {
				// not supported: the focused select still takes arrow keys
			}
		} else if (el instanceof HTMLInputElement && el.type === 'text') {
			el.select();
		}
		return true;
	}

	onMount(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
			// A focused dropdown keeps focus after its picker closes; Esc or any shortcut key
			// releases it instead of type-ahead silently changing the value.
			if (e.target instanceof HTMLSelectElement && e.target.closest('aside')) {
				if (e.key !== 'Escape' && !SHORTCUTS.some(([k]) => k === e.key)) return;
				e.preventDefault();
				e.target.blur();
				if (e.key !== 'Escape') runShortcut(e.key);
				return;
			}
			if ((e.target as HTMLElement).closest('input, textarea, select, [contenteditable]')) return;
			if (showShortcuts) {
				if (e.key === 'Escape' || e.key === '?') {
					e.preventDefault();
					showShortcuts = false;
				}
				return;
			}
			if (e.key === 'Escape') {
				if (menu?.open) menu.open = false;
				else goto(nav.listUrl);
				return;
			}
			if (runShortcut(e.key)) e.preventDefault();
		};
		// paste a screenshot anywhere on the page to attach it
		const onPaste = (e: ClipboardEvent) => {
			const files = filesFrom(e.clipboardData);
			if (!files.length) return;
			e.preventDefault();
			attach(files);
		};
		// close the ⋯ menu on any click outside it
		const onClick = (e: MouseEvent) => {
			if (menu?.open && !menu.contains(e.target as Node)) menu.open = false;
		};
		try {
			commentsOnly = localStorage.getItem('issue.commentsOnly') === '1';
		} catch {
			// storage blocked: show everything
		}
		// picking a value from a dropdown hands focus back to the page
		const onChange = (e: Event) => {
			if (e.target instanceof HTMLSelectElement && e.target.closest('aside')) e.target.blur();
		};
		window.addEventListener('keydown', onKey);
		window.addEventListener('change', onChange);
		window.addEventListener('paste', onPaste);
		window.addEventListener('click', onClick);
		return () => {
			window.removeEventListener('keydown', onKey);
			window.removeEventListener('change', onChange);
			window.removeEventListener('paste', onPaste);
			window.removeEventListener('click', onClick);
		};
	});
</script>

<svelte:window
	ondragover={(e) => {
		if (!e.dataTransfer?.types.includes('Files')) return;
		e.preventDefault();
		dragging = true;
	}}
	ondragleave={(e) => !e.relatedTarget && (dragging = false)}
	ondrop={(e) => {
		if (!e.dataTransfer?.files.length) return;
		e.preventDefault();
		dragging = false;
		attach(filesFrom(e.dataTransfer));
	}}
/>

{#if dragging}
	<div
		class="pointer-events-none fixed inset-2 z-50 flex items-center justify-center rounded-lg border-2 border-dashed border-zinc-400 bg-white/80 text-lg text-zinc-600 dark:bg-zinc-950/80 dark:text-zinc-300"
	>
		Drop to attach to #{issue.id}
	</div>
{/if}

{#if showShortcuts}
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div
		class="fixed inset-0 z-40 flex items-center justify-center bg-black/30"
		onclick={() => (showShortcuts = false)}
	>
		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<div
			class="w-80 rounded-lg border border-zinc-200 bg-white p-3 shadow-xl dark:border-zinc-800 dark:bg-zinc-950"
			role="dialog"
			aria-modal="true"
			aria-label="Keyboard shortcuts"
			tabindex="-1"
			onclick={(e) => e.stopPropagation()}
		>
			<h2 class="mb-2 text-xs font-medium tracking-wide text-zinc-500 uppercase">
				Keyboard shortcuts
			</h2>
			<dl class="grid grid-cols-[4.5rem_1fr] gap-x-2 gap-y-1 text-sm">
				{#each SHORTCUTS as [key, what] (key)}
					<dt>
						<span class="kbd"
							>{key.length === 1 && key !== key.toLowerCase() ? `Shift+${key}` : key}</span
						>
					</dt>
					<dd class="text-zinc-600 dark:text-zinc-400">{what}</dd>
				{/each}
			</dl>
			<p class="mt-2 text-xs text-zinc-400">
				In text boxes: <span class="kbd">Ctrl+Enter</span> save · <span class="kbd">Esc</span> close
			</p>
		</div>
	</div>
{/if}

<svelte:head><title>#{issue.id} {issue.title}</title></svelte:head>

<div class="mb-3 flex items-center gap-3 text-zinc-500">
	<a href={nav.listUrl} class="hover:underline">← Issues</a>
	<span class="text-xs text-zinc-400"
		><span class="kbd">Esc</span> back ·
		<button class="hover:underline" onclick={() => (showShortcuts = true)}
			><span class="kbd">?</span> shortcuts</button
		></span
	>
	{#if !status?.isClosed}
		<div class="ml-auto">
			<TodayToggle issueId={issue.id} selected={data.todayIds.includes(issue.id)} shortcut="*" />
		</div>
	{/if}
</div>

<div class="grid gap-6 md:grid-cols-[1fr_16rem]">
	<section class="min-w-0">
		{#if data.parent}
			<a
				href="/issues/{data.parent.id}"
				class="mb-1 inline-block text-xs text-zinc-500 hover:underline"
				>↳ Subtask of <span class="font-sans">#{data.parent.id}</span> {data.parent.title}</a
			>
		{/if}
		<div class="flex items-baseline gap-2">
			<button
				type="button"
				class="group/id flex shrink-0 items-center gap-1 self-center rounded px-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-900 dark:hover:text-zinc-200"
				title="Copy #{issue.id} (i)"
				aria-label="Copy issue ID #{issue.id}"
				aria-keyshortcuts="i"
				onclick={copyId}
			>
				#{issue.id}
				<svg
					width="13"
					height="13"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
					aria-hidden="true"
					class="opacity-50 group-hover/id:opacity-100"
				>
					{#if idCopied}
						<path d="M20 6 9 17l-5-5" />
					{:else}
						<rect x="9" y="9" width="12" height="12" rx="2" />
						<path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
					{/if}
				</svg>
			</button>
			<input
				data-key="E"
				bind:value={title}
				onblur={saveTitle}
				onkeydown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
				class="w-full rounded bg-transparent px-1 text-lg font-semibold outline-none hover:bg-zinc-50 focus:bg-zinc-50 dark:hover:bg-zinc-900 dark:focus:bg-zinc-900"
			/>
			<details class="relative shrink-0 self-center" bind:this={menu}>
				<summary
					class="cursor-pointer list-none rounded px-2 text-lg leading-6 text-zinc-400 select-none hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-900 dark:hover:text-zinc-200"
					title="More actions">⋯</summary
				>
				<div
					class="absolute right-0 z-20 mt-1 w-40 rounded border border-zinc-200 bg-white p-1 text-sm shadow-md dark:border-zinc-800 dark:bg-zinc-950"
				>
					<button
						class="block w-full rounded px-2 py-1 text-left hover:bg-zinc-100 dark:hover:bg-zinc-900"
						onclick={copyId}>Copy ID <span class="kbd float-right">i</span></button
					>
					<button
						class="block w-full rounded px-2 py-1 text-left hover:bg-zinc-100 dark:hover:bg-zinc-900"
						onclick={copyLink}>Copy link <span class="kbd float-right">y</span></button
					>
					<button
						class="block w-full rounded px-2 py-1 text-left text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950"
						onclick={remove}>Move to Trash…</button
					>
				</div>
			</details>
		</div>

		<div class="mt-3">
			{#if editing || !description.trim()}
				<textarea
					bind:this={descriptionInput}
					bind:value={description}
					onfocus={() => (editing = true)}
					onblur={finishDescription}
					onkeydown={ctrlEnter(() => descriptionInput?.blur())}
					rows="10"
					placeholder="Description, steps to reproduce, expected vs actual… (Markdown)"
					class="input w-full resize-y text-[13.5px] leading-relaxed"></textarea>
				<p class="mt-0.5 text-xs text-zinc-400">
					{description !== issue.description ? 'Unsaved — saves on blur or Ctrl+Enter' : 'Saved'}
					· Markdown supported
				</p>
			{:else}
				<!-- keyboard path: the `e` shortcut and the Edit button -->
				<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
				<div
					class="group relative cursor-text rounded border border-transparent px-2 py-1.5 hover:border-zinc-200 dark:hover:border-zinc-800"
					onclick={onRenderedClick}
				>
					<button
						class="absolute top-1 right-1 rounded px-1.5 text-xs text-zinc-400 opacity-0 group-hover:opacity-100 hover:bg-zinc-100 hover:text-zinc-700 focus:opacity-100 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
						onclick={(e) => {
							e.stopPropagation();
							editDescription();
						}}>Edit <span class="kbd">e</span></button
					>
					<Markdown source={description} />
				</div>
			{/if}
		</div>

		{#key issue.id}<ResumeNote {issue} bind:open={resumeOpen} />{/key}

		{#snippet heading(label: string)}
			<h2 class="mb-1.5 text-xs font-medium tracking-wide text-zinc-500 uppercase">{label}</h2>
		{/snippet}
		{#snippet addButton(
			label: string,
			active: boolean,
			onclick: () => void,
			disabled = false,
			key = ''
		)}
			<button
				title={key ? `Shortcut: ${key}` : undefined}
				aria-keyshortcuts={key || undefined}
				class="rounded px-1.5 py-0.5 hover:bg-zinc-100 hover:text-zinc-800 disabled:opacity-50 dark:hover:bg-zinc-900 dark:hover:text-zinc-200 {active
					? 'bg-zinc-100 text-zinc-800 dark:bg-zinc-900 dark:text-zinc-200'
					: ''}"
				{disabled}
				{onclick}>{label}</button
			>
		{/snippet}

		<div class="mt-3 flex flex-wrap items-center gap-1 text-xs text-zinc-500">
			{#if !issue.parentId}
				{@render addButton(
					'+ Subtask',
					adding === 'subtask',
					() => toggleAdding('subtask'),
					false,
					'Shift+S'
				)}
			{/if}
			{@render addButton('+ Link', adding === 'link', () => toggleAdding('link'), false, 'Shift+L')}
			{@render addButton(
				'+ Related',
				adding === 'relation',
				() => toggleAdding('relation'),
				false,
				'Shift+R'
			)}
			{#if !issue.stopped.trim() && !issue.nextAction.trim()}
				{@render addButton(
					'+ Resume note',
					resumeOpen,
					() => (resumeOpen = !resumeOpen),
					false,
					'r'
				)}
			{/if}
			{#if data.attachmentsEnabled}
				{@render addButton(
					uploading ? `Uploading ${uploading}…` : '+ Attach',
					false,
					() => picker?.click(),
					uploading > 0,
					'a'
				)}
				<span class="ml-1 text-zinc-400">or paste / drop files</span>
				<input
					bind:this={picker}
					type="file"
					multiple
					hidden
					onchange={(e) => {
						attach([...(e.currentTarget.files ?? [])]);
						e.currentTarget.value = '';
					}}
				/>
			{/if}
		</div>

		{#if adding === 'subtask'}
			<form
				class="mt-1.5 flex gap-2"
				onsubmit={(e) => {
					e.preventDefault();
					addSubtask();
				}}
			>
				<input
					{@attach focus}
					onkeydown={closeOnEscape}
					bind:value={newSubtask}
					placeholder="Subtask title — Enter adds, Esc closes (a task in {issue.appName})"
					class="input min-w-0 flex-1 py-0.5"
				/>
				<button class="btn py-0.5" disabled={!newSubtask.trim()}>Add</button>
			</form>
		{:else if adding === 'link'}
			<form
				class="mt-1.5 flex gap-2"
				onsubmit={(e) => {
					e.preventDefault();
					addLink();
				}}
			>
				<input
					{@attach focus}
					onkeydown={closeOnEscape}
					bind:value={newLink.url}
					placeholder="URL — PR, commit, Sentry, doc…"
					class="input min-w-0 flex-[2] py-0.5"
				/>
				<input
					bind:value={newLink.title}
					onkeydown={closeOnEscape}
					placeholder="Title (optional)"
					class="input min-w-0 flex-1 py-0.5"
				/>
				<button class="btn py-0.5" disabled={!newLink.url.trim()}>Add</button>
			</form>
		{:else if adding === 'relation'}
			<form
				class="mt-1.5 flex gap-2"
				onsubmit={(e) => {
					e.preventDefault();
					addRelation();
				}}
			>
				<span class="self-center text-zinc-500">This issue</span>
				<select bind:value={relKind} onkeydown={closeOnEscape} class="input py-0.5">
					{#each RELATION_KINDS as k (k.value)}<option value={k.value}>{k.label}</option>{/each}
				</select>
				<input
					{@attach focus}
					onkeydown={closeOnEscape}
					bind:value={relTarget}
					placeholder="#12"
					class="input w-24 py-0.5"
				/>
				<button class="btn py-0.5" disabled={!relTarget.trim()}>Add</button>
			</form>
		{/if}

		{#if data.subtasks.length}
			{@const done = data.subtasks.filter((t) => t.isClosed).length}
			<div class="mt-4">
				<div class="mb-1.5 flex items-center gap-2">
					<h2 class="text-xs font-medium tracking-wide text-zinc-500 uppercase">Subtasks</h2>
					<span
						class="h-1.5 w-20 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800"
						title="{done} of {data.subtasks.length} done"
					>
						<span
							class="block h-full rounded-full bg-green-500"
							style="width:{(done / data.subtasks.length) * 100}%"
						></span>
					</span>
					<span class="text-xs text-zinc-400 tabular-nums">{done}/{data.subtasks.length}</span>
				</div>
				<ul class="space-y-0.5">
					{#each data.subtasks as t (t.id)}
						{@const st = statusById.get(t.statusId)}
						<li class="flex items-baseline gap-2">
							<span class={t.isClosed ? 'text-green-600 dark:text-green-400' : 'text-zinc-400'}
								>{t.isClosed ? '☑' : '☐'}</span
							>
							<a
								href="/issues/{t.id}"
								class="min-w-0 truncate hover:underline {t.isClosed
									? 'text-zinc-400 line-through decoration-zinc-300 dark:decoration-zinc-700'
									: ''}"><span class="text-xs text-zinc-400">#{t.id}</span> {t.title}</a
							>
							<span class="ml-auto shrink-0 text-xs" style="color:{st?.color}">{st?.name}</span>
						</li>
					{/each}
				</ul>
			</div>
		{/if}

		<!-- links and related issues: one compact list, the left column says what each row is -->
		{#if data.links.length || data.relations.length}
			<ul class="mt-4 space-y-0.5">
				{#each data.links as l (l.id)}
					<li class="group flex items-baseline gap-2">
						<span class="w-24 shrink-0 text-xs text-zinc-500">link</span>
						<a
							href={l.url}
							target="_blank"
							rel="noopener noreferrer"
							title={l.url}
							class="min-w-0 truncate text-blue-600 hover:underline dark:text-blue-400"
							>{l.title || linkText(l.url)}</a
						>
						{#if l.title}<span class="hidden truncate text-xs text-zinc-400 sm:inline"
								>{linkText(l.url)}</span
							>{/if}
						<button
							class="ml-auto shrink-0 text-xs text-zinc-400 opacity-0 group-hover:opacity-100 hover:text-red-500"
							title="Remove link"
							onclick={() => api('DELETE', `/api/issues/${issue.id}/links`, { linkId: l.id })}
							>✕</button
						>
					</li>
				{/each}
				{#each data.relations as r (r.id)}
					<li class="group flex items-baseline gap-2">
						<span
							class="w-24 shrink-0 text-xs {r.kind === 'blocked_by' && !r.otherClosed
								? 'text-red-500'
								: 'text-zinc-500'}">{relationLabel(r.kind)}</span
						>
						<a
							href="/issues/{r.otherId}"
							class="min-w-0 truncate hover:underline {r.otherClosed
								? 'text-zinc-400 line-through decoration-zinc-300 dark:decoration-zinc-700'
								: ''}"><span class="text-xs text-zinc-400">#{r.otherId}</span> {r.otherTitle}</a
						>
						<button
							class="ml-auto shrink-0 text-xs text-zinc-400 opacity-0 group-hover:opacity-100 hover:text-red-500"
							title="Remove"
							onclick={() =>
								api('DELETE', `/api/issues/${issue.id}/relations`, { relationId: r.id })}>✕</button
						>
					</li>
				{/each}
			</ul>
		{/if}

		{#if data.attachments.length}
			<div class="mt-4">
				{@render heading(`Attachments · ${data.attachments.length}`)}
				<ul class="flex flex-wrap gap-2">
					{#each data.attachments as f (f.id)}
						<li class="group relative w-36 rounded border border-zinc-200 dark:border-zinc-800">
							{#if isMedia(f.mime)}
								<button
									class="block w-full text-left"
									title={f.filename}
									onclick={() => (viewing = media.findIndex((m) => m.id === f.id))}
								>
									{#if f.mime.startsWith('video/')}
										<div class="relative">
											<video
												src="/attachments/{f.id}#t=0.1"
												preload="metadata"
												muted
												class="pointer-events-none h-24 w-full rounded-t bg-zinc-900 object-cover"
											></video>
											<span
												class="absolute inset-0 flex items-center justify-center text-2xl text-white/90 drop-shadow"
												>▶</span
											>
										</div>
									{:else}
										<img
											src="/attachments/{f.id}"
											alt={f.filename}
											loading="lazy"
											class="h-24 w-full rounded-t bg-zinc-50 object-cover dark:bg-zinc-900"
										/>
									{/if}
									<div class="truncate px-1.5 pt-1 text-xs">{f.filename}</div>
								</button>
							{:else}
								<a href="/attachments/{f.id}" target="_blank" rel="noopener" title={f.filename}>
									<div
										class="flex h-24 items-center justify-center rounded-t bg-zinc-50 text-xs text-zinc-400 uppercase dark:bg-zinc-900"
									>
										{f.filename.split('.').pop()?.slice(0, 6) || 'file'}
									</div>
									<div class="truncate px-1.5 pt-1 text-xs">{f.filename}</div>
								</a>
							{/if}
							<div class="flex px-1.5 pb-1 text-xs text-zinc-400">
								{fileSize(f.size)}
								<a
									href="/attachments/{f.id}?download"
									class="ml-auto hover:text-zinc-700 dark:hover:text-zinc-200">↓</a
								>
								<button
									class="ml-2 opacity-0 group-hover:opacity-100 hover:text-red-500"
									onclick={() => removeAttachment(f.id, f.filename)}>✕</button
								>
							</div>
						</li>
					{/each}
				</ul>
			</div>
		{/if}

		<MediaViewer items={media} bind:index={viewing} />

		{#snippet changeLine(ev: IssueEvent)}
			{#if ev.field === 'description'}
				edited description
			{:else if ev.field === 'attachment'}
				{ev.newValue ? `attached ${ev.newValue}` : `removed ${ev.oldValue}`}
			{:else if ev.field === 'link'}
				{ev.newValue ? `added link ${ev.newValue}` : `removed link ${ev.oldValue}`}
			{:else if ev.field === 'relation'}
				{ev.newValue ? `marked as ${ev.newValue}` : `removed “${ev.oldValue}”`}
			{:else}
				<span class="text-zinc-400">{ev.field}:</span>
				<span class="line-through opacity-60">{ev.oldValue ?? '—'}</span> →
				<span>{ev.newValue ?? '—'}</span>
			{/if}
		{/snippet}
		{#snippet who(ev: IssueEvent)}
			{#if ev.userName}<span class="text-zinc-700 dark:text-zinc-300">{ev.userName}</span>{/if}
		{/snippet}

		<div class="mt-6 mb-2 flex items-center gap-2">
			<h2 class="text-xs font-medium tracking-wide text-zinc-500 uppercase">Activity</h2>
			<label class="ml-auto flex cursor-pointer items-center gap-1.5 text-xs text-zinc-500">
				<input
					type="checkbox"
					checked={commentsOnly}
					onchange={(e) => setCommentsOnly(e.currentTarget.checked)}
				/>
				Comments only
			</label>
		</div>
		<ol class="space-y-2 border-l border-zinc-200 pl-4 dark:border-zinc-800">
			{#if !commentsOnly}
				<li class="text-xs text-zinc-400" title={fullDate(issue.createdAt)}>
					Created{issue.createdByName ? ` by ${issue.createdByName}` : ''}
					{ago(issue.createdAt)}
				</li>
			{:else if !hasComments}
				<li class="text-xs text-zinc-400">No comments yet.</li>
			{/if}
			{#each activity as item (item.kind === 'comment' ? `c${item.ev.id}` : `g${item.key}`)}
				{#if item.kind === 'changes'}
					{#if !commentsOnly}
						{@const first = item.events[0]}
						{@const last = item.events.at(-1)!}
						{#if item.events.length === 1}
							<li class="text-xs text-zinc-500" title={fullDate(first.createdAt)}>
								{@render who(first)}
								{@render changeLine(first)}
								<span class="text-zinc-400">· {ago(first.createdAt)}</span>
							</li>
						{:else}
							{@const open = expanded.has(item.key)}
							<li class="text-xs text-zinc-500">
								<button
									class="text-left hover:text-zinc-800 dark:hover:text-zinc-200"
									title={fullDate(last.createdAt)}
									onclick={() => (open ? expanded.delete(item.key) : expanded.add(item.key))}
								>
									<span class="inline-block w-2 text-zinc-400">{open ? '▾' : '▸'}</span>
									{@render who(first)}
									changed {changedFields(item.events)}
									<span class="text-zinc-400">· {ago(last.createdAt)}</span>
								</button>
								{#if open}
									<ul class="mt-1 space-y-1 pl-3">
										{#each item.events as ev (ev.id)}
											<li title={fullDate(ev.createdAt)}>{@render changeLine(ev)}</li>
										{/each}
									</ul>
								{/if}
							</li>
						{/if}
					{/if}
				{:else}
					{@const ev = item.ev}
					<li class="group rounded border border-zinc-200 p-2 dark:border-zinc-800">
						<div class="mb-1 flex text-xs text-zinc-400">
							{#if ev.userName}<span class="mr-1 font-medium text-zinc-600 dark:text-zinc-300"
									>{ev.userName}</span
								>{/if}
							<span title={fullDate(ev.createdAt)}>{ago(ev.createdAt)}</span>
							{#if data.user?.role === 'admin' || ev.userId === data.user?.id}
								<button
									class="ml-auto opacity-0 group-hover:opacity-100 hover:text-red-500"
									onclick={() =>
										confirm('Delete comment?') &&
										api('DELETE', `/api/issues/${issue.id}/comments`, { eventId: ev.id })}
									>delete</button
								>
							{/if}
						</div>
						<Markdown source={ev.body ?? ''} />
					</li>
				{/if}
			{/each}
		</ol>

		<div class="mt-3">
			<textarea
				data-key="c"
				bind:value={comment}
				onkeydown={ctrlEnter(addComment)}
				rows="3"
				placeholder="Add a note… (Markdown, Ctrl+Enter to send · c to focus)"
				class="input w-full"></textarea>
			<button class="btn mt-1" disabled={!comment.trim()} onclick={addComment}>Comment</button>
		</div>
	</section>

	<aside class="text-sm">
		{#snippet label(text: string)}
			<span class="truncate text-xs text-zinc-500">{text}</span>
		{/snippet}
		{#snippet divider()}
			<div class="col-span-2 my-1.5 border-t border-zinc-100 dark:border-zinc-900"></div>
		{/snippet}
		<div class="grid grid-cols-[5.5rem_minmax(0,1fr)] items-center gap-x-1">
			{@render label('Status')}
			<select
				data-key="s"
				class="prop"
				style="color:{status?.color}"
				value={issue.statusId}
				onchange={(e) => save({ statusId: Number(e.currentTarget.value) })}
			>
				{#each data.statuses as s (s.id)}<option value={s.id} style="color:{s.color}"
						>{s.name}</option
					>{/each}
			</select>
			{@render label('Priority')}
			<select
				data-key="p"
				class="prop {PRIORITY_CLASS[issue.priority]}"
				value={issue.priority}
				onchange={(e) => save({ priority: Number(e.currentTarget.value) })}
			>
				{#each PRIORITIES as p (p.value)}<option value={p.value} class={PRIORITY_CLASS[p.value]}
						>{p.label}</option
					>{/each}
			</select>
			{@render label('Type')}
			<select
				data-key="t"
				class="prop {TYPE_CLASS[issue.type]}"
				value={issue.type}
				onchange={(e) => save({ type: e.currentTarget.value as never })}
			>
				{#each TYPES as t (t)}<option value={t} class={TYPE_CLASS[t]}>{TYPE_LABEL[t]}</option
					>{/each}
			</select>
			{@render label('App')}
			<select
				class="prop"
				value={issue.appId ?? ''}
				onchange={(e) =>
					save({ appId: e.currentTarget.value ? Number(e.currentTarget.value) : null })}
			>
				<option value="">Inbox (no app)</option>
				{#each data.apps as a (a.id)}<option value={a.id}>{a.name}</option>{/each}
			</select>

			{@render divider()}

			{@render label('Milestone')}
			<select
				data-key="m"
				class="prop {faint(!issue.milestoneId)}"
				value={issue.milestoneId ?? ''}
				onchange={(e) => chooseMilestone(e.currentTarget)}
			>
				<option value="">—</option>
				{#each data.milestones.filter((m) => !m.done || m.id === issue.milestoneId) as m (m.id)}<option
						value={m.id}>{m.name}</option
					>{/each}
				<option value="new">+ New milestone…</option>
			</select>
			{@render label('Size')}
			<select
				class="prop uppercase {faint(!issue.size)}"
				value={issue.size ?? ''}
				onchange={(e) => save({ size: (e.currentTarget.value || null) as never })}
			>
				<option value="">—</option>
				{#each SIZES as sz (sz)}<option value={sz}>{sz.toUpperCase()}</option>{/each}
			</select>
			{@render label('Due')}
			<!-- empty: a text field showing "—" that turns into a date picker on focus -->
			<input
				data-key="d"
				type={issue.dueDate ? 'date' : 'text'}
				class="prop"
				value={issue.dueDate ?? ''}
				placeholder="—"
				onfocus={(e) => {
					if (e.currentTarget.type === 'date') return;
					e.currentTarget.type = 'date';
					try {
						e.currentTarget.showPicker();
					} catch {
						// not supported or not allowed: the native field still works
					}
				}}
				onblur={(e) => !e.currentTarget.value && (e.currentTarget.type = 'text')}
				onchange={(e) => save({ dueDate: e.currentTarget.value || null })}
			/>
			{@render label('Repeat')}
			<select
				class="prop {faint(!issue.repeat)}"
				value={issue.repeat ?? ''}
				title="Closing it creates the next one, due one interval later"
				onchange={(e) => save({ repeat: (e.currentTarget.value || null) as never })}
			>
				<option value="">—</option>
				{#each REPEATS as r (r.value)}<option value={r.value}>↻ {r.label}</option>{/each}
			</select>
			{@render label('Remind me')}
			{#if issue.remindAt && !pickingReminder}
				<span class="flex min-w-0 items-center gap-1 px-1.5 py-1">
					<span class="truncate" title="You’ll get a notification then"
						>🔔 {reminderText(issue.remindAt)}</span
					>
					<button
						class="ml-auto text-xs text-zinc-400 hover:text-red-500"
						title="Remove reminder"
						onclick={() => setReminder(null)}>✕</button
					>
				</span>
			{:else if pickingReminder}
				<input
					type="datetime-local"
					class="prop"
					{@attach (el: HTMLInputElement) => el.focus()}
					onchange={(e) => e.currentTarget.value && setReminder(new Date(e.currentTarget.value))}
					onblur={() => (pickingReminder = false)}
				/>
			{:else}
				<select
					class="prop {faint(true)}"
					value=""
					onchange={(e) => {
						const v = e.currentTarget.value;
						e.currentTarget.value = '';
						if (v === 'pick') pickingReminder = true;
						else if (v) setReminder(REMINDER_PRESETS[Number(v)].at());
					}}
				>
					<option value="">—</option>
					{#each REMINDER_PRESETS as p, i (p.label)}<option value={String(i)}>{p.label}</option
						>{/each}
					<option value="pick">Pick a time…</option>
				</select>
			{/if}
			{@render label('Parent')}
			<input
				class="prop disabled:cursor-not-allowed"
				value={issue.parentId ? `#${issue.parentId}` : ''}
				onchange={(e) => setParent(e.currentTarget)}
				onkeydown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
				disabled={data.subtasks.length > 0}
				title={data.subtasks.length
					? 'Has subtasks, so it can’t be a subtask itself'
					: '#12 makes this a subtask of #12'}
				placeholder={data.subtasks.length ? 'has subtasks' : '—'}
			/>

			{@render divider()}

			{#if issue.type === 'bug' || issue.severity}
				{@render label('Severity')}
				<select
					class="prop {issue.severity ? SEVERITY_CLASS[issue.severity] : faint(true)}"
					value={issue.severity ?? ''}
					onchange={(e) => save({ severity: (e.currentTarget.value || null) as never })}
				>
					<option value="">—</option>
					{#each SEVERITIES as sv (sv.value)}<option
							value={sv.value}
							class={SEVERITY_CLASS[sv.value]}>{sv.label}</option
						>{/each}
				</select>
			{/if}
			{#if issue.type === 'bug' || issue.environment}
				{@render label('Environment')}
				<select
					class="prop {issue.environment ? ENV_CLASS[issue.environment] : faint(true)}"
					value={issue.environment ?? ''}
					onchange={(e) => save({ environment: (e.currentTarget.value || null) as never })}
				>
					<option value="">—</option>
					{#each ENVIRONMENTS as en (en.value)}<option value={en.value} class={ENV_CLASS[en.value]}
							>{en.label}</option
						>{/each}
				</select>
			{/if}
			{#if issue.type === 'bug' || issue.version}
				{@render label('Found in')}
				<input
					class="prop"
					value={issue.version ?? ''}
					onchange={(e) => save({ version: e.currentTarget.value })}
					onkeydown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
					placeholder="—"
				/>
			{/if}
			{@render label('Fixed in')}
			<input
				class="prop"
				value={issue.fixedIn ?? ''}
				onchange={(e) => save({ fixedIn: e.currentTarget.value })}
				onkeydown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
				placeholder="—"
			/>

			{@render divider()}

			{@render label('Labels')}
			<input
				data-key="l"
				class="prop"
				bind:value={labels}
				onblur={saveLabels}
				onkeydown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
				list="labels"
				placeholder="—"
				title="Space separated"
			/>
			<datalist id="labels"
				>{#each data.labels as l (l)}<option value={l}></option>{/each}</datalist
			>
		</div>

		<dl
			class="mt-3 space-y-0.5 border-t border-zinc-200 pt-3 text-xs text-zinc-500 dark:border-zinc-800"
		>
			<div title={fullDate(issue.createdAt)}>Created {ago(issue.createdAt)}</div>
			<div title={fullDate(issue.updatedAt)}>Updated {ago(issue.updatedAt)}</div>
			{#if issue.closedAt}<div title={fullDate(issue.closedAt)}>
					Closed {ago(issue.closedAt)}
				</div>{/if}
		</dl>
	</aside>
</div>
