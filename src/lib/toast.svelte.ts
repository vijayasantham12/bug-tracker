export const toast = $state({ message: '', error: false });

let timer: ReturnType<typeof setTimeout>;

export function notify(message: string, error = false) {
	toast.message = message;
	toast.error = error;
	clearTimeout(timer);
	timer = setTimeout(() => (toast.message = ''), error ? 5000 : 2000);
}
