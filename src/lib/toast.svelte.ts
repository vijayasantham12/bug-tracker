export interface ToastAction {
	label: string;
	run: () => void;
}

export const toast = $state<{ message: string; error: boolean; action: ToastAction | null }>({
	message: '',
	error: false,
	action: null
});

let timer: ReturnType<typeof setTimeout>;

/** Shows a toast; with an `action` (e.g. Undo) it stays up a little longer. */
export function notify(message: string, error = false, action: ToastAction | null = null) {
	toast.message = message;
	toast.error = error;
	toast.action = action;
	clearTimeout(timer);
	timer = setTimeout(() => (toast.message = ''), error || action ? 5000 : 2000);
}
