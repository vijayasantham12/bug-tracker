import type { Attachment } from 'svelte/attachments';

/** Installed to the home screen (no browser chrome, so no native pull-to-refresh). */
export const isStandalone = () =>
	matchMedia('(display-mode: standalone)').matches ||
	(navigator as Navigator & { standalone?: boolean }).standalone === true;

/**
 * Keeps `--kb` on <html> at the on-screen keyboard's height, so bottom sheets sit on top of it.
 * Android (interactive-widget=resizes-content) shrinks the layout instead, which leaves this at 0.
 */
export function trackKeyboard() {
	const vv = window.visualViewport;
	if (!vv) return () => {};
	const update = () => {
		const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
		document.documentElement.style.setProperty('--kb', `${Math.round(kb)}px`);
	};
	vv.addEventListener('resize', update);
	vv.addEventListener('scroll', update);
	update();
	return () => {
		vv.removeEventListener('resize', update);
		vv.removeEventListener('scroll', update);
	};
}

export interface SwipeAction {
	label: string;
	/** background class for the revealed strip */
	cls: string;
	run: () => void;
}

const THRESHOLD = 88;

/**
 * Swipe a row sideways to reveal an action; let go past the threshold to run it.
 * `right` is revealed by swiping right (on the left edge), `left` by swiping left.
 * Touch only: vertical scrolling stays native (touch-action: pan-y), mice are ignored.
 */
export function swipe(actions: {
	right?: SwipeAction;
	left?: SwipeAction;
}): Attachment<HTMLElement> {
	return (el) => {
		const content = el.firstElementChild as HTMLElement | null;
		if (!content) return;
		el.style.touchAction = 'pan-y';
		const strip = document.createElement('div');
		strip.setAttribute('aria-hidden', 'true');
		strip.className =
			'swipe-strip pointer-events-none absolute inset-0 flex items-center px-5 text-sm font-medium text-white opacity-0';
		el.prepend(strip);

		let x0 = 0;
		let y0 = 0;
		let dx = 0;
		let tracking: 'maybe' | 'x' | null = null;
		let id = -1;

		const set = (x: number, animate: boolean) => {
			content.style.transition = animate ? 'transform 180ms ease-out' : 'none';
			content.style.transform = x ? `translateX(${x}px)` : '';
			const action = x > 0 ? actions.right : x < 0 ? actions.left : undefined;
			strip.style.opacity = action ? String(Math.min(1, Math.abs(x) / THRESHOLD)) : '0';
			if (action) {
				strip.className = strip.className.replace(/ bg-\S+/g, '') + ` ${action.cls}`;
				strip.style.justifyContent = x > 0 ? 'flex-start' : 'flex-end';
				strip.textContent = action.label;
			}
			el.dataset.armed = Math.abs(x) >= THRESHOLD ? 'true' : '';
		};

		const down = (e: PointerEvent) => {
			if (e.pointerType === 'mouse' || tracking) return;
			x0 = e.clientX;
			y0 = e.clientY;
			dx = 0;
			id = e.pointerId;
			tracking = 'maybe';
		};
		const move = (e: PointerEvent) => {
			if (!tracking || e.pointerId !== id) return;
			const mx = e.clientX - x0;
			const my = e.clientY - y0;
			if (tracking === 'maybe') {
				if (Math.abs(my) > 10 && Math.abs(my) > Math.abs(mx)) return void (tracking = null);
				if (Math.abs(mx) < 10) return;
				tracking = 'x';
				el.setPointerCapture(id);
			}
			// only toward a side that has an action; rubber-band past the threshold
			if ((mx > 0 && !actions.right) || (mx < 0 && !actions.left)) dx = 0;
			else
				dx =
					Math.abs(mx) > THRESHOLD
						? Math.sign(mx) * (THRESHOLD + (Math.abs(mx) - THRESHOLD) / 3)
						: mx;
			set(dx, false);
		};
		const up = () => {
			if (tracking === 'x') {
				const action =
					dx >= THRESHOLD ? actions.right : dx <= -THRESHOLD ? actions.left : undefined;
				if (action) {
					navigator.vibrate?.(10);
					action.run();
				}
				set(0, true);
			}
			tracking = null;
		};
		// a swipe must not also count as a tap on the link underneath
		const click = (e: MouseEvent) => {
			if (Math.abs(dx) > 10) {
				e.preventDefault();
				e.stopPropagation();
				dx = 0;
			}
		};

		el.addEventListener('pointerdown', down);
		el.addEventListener('pointermove', move);
		el.addEventListener('pointerup', up);
		el.addEventListener('pointercancel', up);
		el.addEventListener('click', click, true);
		return () => {
			el.removeEventListener('pointerdown', down);
			el.removeEventListener('pointermove', move);
			el.removeEventListener('pointerup', up);
			el.removeEventListener('pointercancel', up);
			el.removeEventListener('click', click, true);
			strip.remove();
		};
	};
}

/**
 * Pull down at the top of the page to refresh. Only for the installed app: browsers already do this.
 * `indicator` gets translated/rotated while pulling; `refresh` runs on release past the threshold.
 */
export function pullToRefresh(indicator: HTMLElement, refresh: () => Promise<unknown>) {
	const PULL = 70;
	let y0 = 0;
	let x0 = 0;
	let dy = 0;
	let active = false;
	let busy = false;

	const show = (y: number, animate = false) => {
		indicator.style.transition = animate ? 'transform 200ms, opacity 200ms' : 'none';
		indicator.style.transform = `translate(-50%, ${Math.min(y, PULL * 1.4) - 40}px) rotate(${y * 4}deg)`;
		indicator.style.opacity = String(Math.min(1, y / PULL));
	};
	const start = (e: TouchEvent) => {
		if (busy || window.scrollY > 0 || e.touches.length !== 1) return;
		const t = e.target as HTMLElement;
		// inner scrollers, text boxes, swipeable rows and open dialogs keep their own gestures
		if (
			t.closest(
				'textarea, input, select, [role="dialog"], dialog, .overflow-y-auto, .overflow-x-auto'
			)
		)
			return;
		if (document.documentElement.style.overflow === 'hidden') return;
		y0 = e.touches[0].clientY;
		x0 = e.touches[0].clientX;
		dy = 0;
		active = true;
	};
	const moveT = (e: TouchEvent) => {
		if (!active) return;
		const my = e.touches[0].clientY - y0;
		const mx = e.touches[0].clientX - x0;
		if (my <= 0 || Math.abs(mx) > my || window.scrollY > 0) {
			if (dy) show(0, true);
			active = my > -5 && Math.abs(mx) <= 10;
			dy = 0;
			return;
		}
		dy = my / 2;
		show(dy);
	};
	const end = async () => {
		if (!active) return;
		active = false;
		if (dy < PULL) return show(0, true);
		busy = true;
		navigator.vibrate?.(10);
		show(PULL, true);
		const spinner = indicator.firstElementChild ?? indicator;
		spinner.classList.add('animate-spin');
		try {
			await refresh();
		} finally {
			spinner.classList.remove('animate-spin');
			show(0, true);
			busy = false;
			dy = 0;
		}
	};
	window.addEventListener('touchstart', start, { passive: true });
	window.addEventListener('touchmove', moveT, { passive: true });
	window.addEventListener('touchend', end);
	window.addEventListener('touchcancel', end);
	return () => {
		window.removeEventListener('touchstart', start);
		window.removeEventListener('touchmove', moveT);
		window.removeEventListener('touchend', end);
		window.removeEventListener('touchcancel', end);
	};
}
