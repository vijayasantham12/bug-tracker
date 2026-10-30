export const HILL_COLORS = ['#2563eb', '#d97706', '#7c3aed', '#059669', '#db2777', '#0891b2'];
export const HILL_SCOPE_LIMIT = 20;

export function hillPoint(position: number) {
	const p = Math.max(0, Math.min(100, position));
	return { x: 40 + p * 7.2, y: 190 - 145 * Math.sin((Math.PI * p) / 100) ** 2 };
}

export const HILL_PATH = Array.from({ length: 101 }, (_, position) => {
	const { x, y } = hillPoint(position);
	return `${position ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`;
}).join(' ');

export function hillPhase(position: number) {
	if (position === 0) return 'Not started';
	if (position < 50) return 'Figuring things out';
	if (position === 50) return 'Approach figured out';
	if (position < 100) return 'Making it happen';
	return 'Finished';
}
