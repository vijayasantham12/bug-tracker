<script lang="ts">
	import AuthCard from '#lib/components/AuthCard.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

{#if !data.invite}
	<AuthCard
		title="Invite not valid"
		subtitle="This link has expired or was already used. Ask for a new one."
	>
		<a href="/login" class="text-sm underline">Go to sign in</a>
	</AuthCard>
{:else}
	<AuthCard
		title="Join the bug tracker"
		subtitle="Create your account{data.invite.role === 'admin' ? ' (admin)' : ''}."
	>
		{#if data.signedInAs}
			<p class="mb-3 text-xs text-amber-600">
				You're signed in as {data.signedInAs}. Creating an account here will switch you to the new
				account.
			</p>
		{/if}
		<form method="POST" class="space-y-3">
			<input
				name="name"
				placeholder="Name"
				value={form?.name ?? ''}
				required
				class="input w-full"
				autocomplete="name"
			/>
			{#if data.invite.email}
				<input value={data.invite.email} disabled class="input w-full opacity-70" />
			{:else}
				<input
					name="email"
					type="email"
					placeholder="Email"
					value={form?.email ?? ''}
					required
					class="input w-full"
					autocomplete="email"
				/>
			{/if}
			<input
				name="password"
				type="password"
				placeholder="Password (min 8 characters)"
				required
				minlength="8"
				class="input w-full"
				autocomplete="new-password"
			/>
			{#if form?.message}<p class="text-sm text-red-600">{form.message}</p>{/if}
			<button class="btn-primary w-full py-1.5">Create account</button>
		</form>
	</AuthCard>
{/if}
