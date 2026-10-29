import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	record: vi.fn(),
	sql: vi.fn(),
	send: vi.fn(),
	keys: vi.fn()
}));
vi.mock('./notifications', () => ({ recordNotifications: mocks.record }));
vi.mock('./db', () => ({ sql: mocks.sql }));
vi.mock('$app/env/private', () => ({ VAPID_SUBJECT: 'mailto:test@example.com' }));
vi.mock('web-push', () => ({
	default: { sendNotification: mocks.send, generateVAPIDKeys: mocks.keys },
	WebPushError: class extends Error {}
}));

import { notifyUsers } from './push';

const payload = { title: 'Reminder', body: 'Fix checkout', url: '/issues/12', tag: 'remind-12' };
const device = { id: 1, endpoint: 'https://push.example.test/1', p256dh: 'key', auth: 'auth' };

beforeEach(() => {
	vi.resetAllMocks();
	mocks.record.mockResolvedValue([7]);
	mocks.send.mockResolvedValue(undefined);
	mocks.keys.mockReturnValue({ publicKey: 'public', privateKey: 'private' });
});

describe('inbox and push delivery', () => {
	it('saves a notification even when the user has no push devices', async () => {
		mocks.sql.mockResolvedValue([]);
		await notifyUsers([7], 'reminders', payload);
		expect(mocks.record).toHaveBeenCalledWith([7], 'reminders', payload);
		expect(mocks.record.mock.invocationCallOrder[0]).toBeLessThan(
			mocks.sql.mock.invocationCallOrder[0]
		);
		expect(mocks.send).not.toHaveBeenCalled();
	});

	it('records once before sending to multiple devices, and keeps history when one fails', async () => {
		mocks.sql
			.mockResolvedValueOnce([
				device,
				{ ...device, id: 2, endpoint: 'https://push.example.test/2' }
			])
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce([
				{ value: JSON.stringify({ publicKey: 'public', privateKey: 'private' }) }
			]);
		mocks.send.mockRejectedValueOnce(new Error('Push service offline'));
		const log = vi.spyOn(console, 'error').mockImplementation(() => {});
		try {
			await expect(notifyUsers([7], 'reminders', payload)).resolves.toBeUndefined();
			expect(mocks.record).toHaveBeenCalledTimes(1);
			expect(mocks.send).toHaveBeenCalledTimes(2);
			expect(mocks.record.mock.invocationCallOrder[0]).toBeLessThan(
				mocks.send.mock.invocationCallOrder[0]
			);
			expect(log).toHaveBeenCalledWith('push failed', device.endpoint, 'Push service offline');
		} finally {
			log.mockRestore();
		}
	});

	it('does not send push when the category has no eligible recipients', async () => {
		mocks.record.mockResolvedValue([]);
		await notifyUsers([7], 'digest', payload);
		expect(mocks.sql).not.toHaveBeenCalled();
		expect(mocks.send).not.toHaveBeenCalled();
	});

	it('also records test notifications, which bypass category switches', async () => {
		mocks.sql.mockResolvedValue([]);
		await notifyUsers([7], null, payload);
		expect(mocks.record).toHaveBeenCalledWith([7], null, payload);
	});
});
