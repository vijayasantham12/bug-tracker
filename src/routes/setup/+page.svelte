<script lang="ts">
	import AuthCard from '#lib/components/AuthCard.svelte';
	import type { PageProps } from './$types';

	let { form }: PageProps = $props();
</script>

<AuthCard
	title="Create admin account"
	subtitle="First run — this account will be the admin. You can invite others afterwards."
>
	<form method="POST" class="space-y-3">
		<input
			name="name"
			placeholder="Name"
			value={form?.name ?? ''}
			required
			class="input w-full"
			autocomplete="name"
		/>
		<input
			name="email"
			type="email"
			placeholder="Email"
			value={form?.email ?? ''}
			required
			class="input w-full"
			autocomplete="email"
		/>
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
		<button class="btn-primary w-full py-1.5">Create admin</button>
	</form>
</AuthCard>
