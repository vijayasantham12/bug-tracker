import { error } from '@sveltejs/kit';
import { HILL_SCOPE_LIMIT } from '#lib/hill.ts';

export interface HillInput {
	revision: number;
	note: string;
	scopes: { id: number | null; name: string; color: string; position: number }[];
}

export function readHillInput(value: unknown): HillInput {
	if (!value || typeof value !== 'object') error(400, 'Invalid Hill Chart update');
	const input = value as Record<string, unknown>;
	if (!Number.isInteger(input.revision) || (input.revision as number) < 0)
		error(400, 'Invalid chart revision');
	if (typeof input.note !== 'string' || input.note.length > 2000)
		error(400, 'Keep the update note to 2,000 characters');
	if (!Array.isArray(input.scopes) || input.scopes.length > HILL_SCOPE_LIMIT)
		error(400, `A Hill Chart can track up to ${HILL_SCOPE_LIMIT} pieces of work`);
	const ids = new Set<number>();
	const scopes = input.scopes.map((value) => {
		if (!value || typeof value !== 'object') error(400, 'Invalid piece of work');
		const scope = value as Record<string, unknown>;
		const id = scope.id ?? null;
		if (id !== null) {
			if (!Number.isInteger(id) || (id as number) <= 0 || (id as number) > 2147483647)
				error(400, 'Invalid piece of work');
			if (ids.has(id as number)) error(400, 'The same piece of work appears twice');
			ids.add(id as number);
		}
		if (typeof scope.name !== 'string' || !scope.name.trim() || scope.name.trim().length > 80)
			error(400, 'Give each piece of work a name of up to 80 characters');
		if (typeof scope.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(scope.color))
			error(400, 'Invalid dot color');
		if (
			!Number.isInteger(scope.position) ||
			(scope.position as number) < 0 ||
			(scope.position as number) > 100
		)
			error(400, 'Hill positions must be whole numbers between 0 and 100');
		return {
			id: id as number | null,
			name: scope.name.trim(),
			color: scope.color.toLowerCase(),
			position: scope.position as number
		};
	});
	return { revision: input.revision as number, note: input.note.trim(), scopes };
}
