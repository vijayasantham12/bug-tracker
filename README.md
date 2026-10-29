# bugs

Minimal bug / feature tracker for a solo dev. SvelteKit + Postgres 18 (podman).

## Run

```sh
podman start postgres-18 rustfs   # Postgres (database `bugtracker`) + RustFS (S3 for attachments)
pnpm dev                          # http://localhost:5173
```

Production: `pnpm build && pnpm start` (reads `.env`).

`DATABASE_URL` is in `.env` (see `.env.example`). The schema in `src/lib/server/schema.sql` is idempotent
and applied automatically on server start. `pnpm db:psql` opens a psql shell.

## Users

- **First run:** with no users yet, every page redirects to `/setup`, where you create the admin account.
  Setup can only happen once.
- **Invites:** in Settings → Users an admin creates an invite link (single use, valid 7 days), optionally
  locked to an email and as admin or member. The link is shown once; send it yourself.
- **Roles:** admins manage users and invites. Everyone else can do everything with issues, statuses and apps.
  Comments can be deleted by their author or an admin. The activity log shows who made each change.
- **Passwords:** scrypt-hashed. Change your own in Settings → Account. 10 failed logins per IP+email lock that
  pair for 15 minutes. If a member forgets their password, remove and re-invite them. If the only admin is
  locked out: `pnpm db:psql` then `delete from users;` and run `/setup` again (issues and history stay).
- **Sessions:** 30 days, extended on use, stored in Postgres (`sessions` table). Sign out ends the session.

## Deploy

```sh
pnpm install && pnpm build
pnpm start            # node build, reads .env, port 3000 (PORT=... to change)
```

Put it behind an HTTPS reverse proxy that forwards the `Host` header (Caddy does by default):

```
bugs.example.com {
	reverse_proxy localhost:3000
}
```

Notes:

- The app assumes `https://<Host>` as its origin, which is what Kit's CSRF check compares form posts against.
  If you serve over plain HTTP instead, build with the exact public origin: `ORIGIN=http://1.2.3.4:3000 pnpm build`,
  or every login and upload is rejected with 403.
- Set `ADDRESS_HEADER=X-Forwarded-For` behind a proxy so login throttling sees real client IPs.
- Session cookies are `Secure` when served over HTTPS.

### Docker

```sh
docker build -t bug-tracker .
docker run -d --name bug-tracker --restart unless-stopped -p 127.0.0.1:3000:3000 \
  -e DATABASE_URL='postgres://user:pass@db-host:5432/bugtracker' \
  -e S3_BUCKET=... -e S3_REGION=... -e S3_ENDPOINT=... -e S3_ACCESS_KEY_ID=... -e S3_SECRET_ACCESS_KEY=... \
  -e ADDRESS_HEADER=X-Forwarded-For \
  bug-tracker
```

(or `--env-file prod.env` with the same variables). The schema is created/updated on startup, so an empty
database is all it needs. `GET /healthz` returns 200 when the DB is reachable, and the image's `HEALTHCHECK` uses it.
Postgres on the same host: use `--network host`, or `host.docker.internal` with
`--add-host=host.docker.internal:host-gateway`, since `localhost` inside the container is the container itself.
Plain HTTP without a proxy: `docker build --build-arg ORIGIN=http://1.2.3.4:3000 -t bug-tracker .`
(podman: add `--format docker` to keep the healthcheck).

## Attachments

Files go to S3 (any S3-compatible store); Postgres only keeps metadata. Locally this is the `rustfs` podman
container (S3 API on :9000, web console on :9001, data in the `rustfs-data` volume, bucket `bug-tracker`).
Credentials are in `.env`; to switch to AWS / R2 / B2, change the `S3_*` variables (see `.env.example`).
Without `S3_BUCKET` the app still works, attachments are just disabled.

- Paste a screenshot (Ctrl+V) anywhere on an issue page, drop files on it, or use **Attach files**.
- Paste/drop into the quick-add box to attach files to the issues you're creating.
- Viewing goes through `/attachments/:id`, which redirects to a 5-minute signed URL, so the bucket stays private.
- Max size per file: `ATTACHMENT_MAX_MB` (default 25). `pnpm start` raises the node body limit to 100M.

## Install as an app

It's an installable PWA: open it in Chrome/Edge and use **Install** in the address bar. Works on `localhost`;
on other devices it needs HTTPS. The service worker only caches static assets, so the server must be running.

## Quick add

Press `n` anywhere on the list. `Enter` adds, `Shift+Enter` starts another line (one issue per line).

```
bug: checkout crashes on safari @shop @admin !high +payments -- only on iOS 18
feat: csv export @shop
```

| Token                                          | Meaning                                                                   |
| ---------------------------------------------- | ------------------------------------------------------------------------- |
| `bug:` `feat:` `task:` `imp:`                  | type (falls back to the type picker on the left)                          |
| `@app`                                         | app; repeat to file the same issue in several apps; new names are created |
| `!urgent` `!high` `!normal` `!low` / `!0`–`!3` | priority (default normal)                                                 |
| `+label`                                       | labels                                                                    |
| `^v1.3`                                        | milestone (created if new)                                                |
| `~xs` `~s` `~m` `~l` `~xl`                     | size                                                                      |
| `*fri` `*tomorrow` `*2w` `*nov5` `*2026-11-05` | due date (weekdays mean the next one, never today)                        |
| `-- text`                                      | description                                                               |

Without `@app`, the app picker on the right is used (remembered per browser). Typing `@`, `^`, `+` or `*`
suggests apps, milestones, labels or dates; `Tab` takes the first. Leading list bullets (`-`, `1.`, `- [ ]`)
are ignored, so a pasted list becomes one issue per line. Similar open issues are flagged as you type.

Press `n` on any other page for the same box in a popup.

## Meeting capture

`/capture` (press `m`) is a notepad for typing while people talk; nothing is saved until **Add all**
(`Ctrl+Enter`). Set the meeting's app, milestone, type and label (default `+meeting-<date>`) once at the top.

```
- checkout crash on safari !high
  only with apple pay            ← indented text: description
- csv export @crm *fri
  - add date filter              ← indented bullet: subtask
  - zip download ~s
```

`Tab`/`Shift+Tab` indent, `Enter` continues the list (on an empty bullet it steps out). The draft is saved
in the browser as you type, and the preview shows exactly what will be created, with duplicate hints.

## Keyboard

On the list: `j`/`k` move, `x` selects, `Enter` opens, `s` `p` `t` `m` set status / priority / type /
milestone (then press a number) for the selected rows or the one under the cursor, `Esc` clears.
Anywhere: `n` quick add, `m` capture, `/` search (list), `e` edit description, `Esc` back (issue page).

## Notifications

Push notifications instead of email: Settings → **Notifications** → **Turn on for this device**, once per
browser or installed app (desktop Chrome/Edge/Firefox/Safari, Android; iPhone/iPad only from the home-screen
app, iOS 16.4+). Needs HTTPS, or `localhost`.

- **Remind me** on an issue (in 1 hour, this evening, tomorrow 09:00, next Monday, or any time).
- **Daily summary** at your chosen time in your timezone: due today, overdue, open production bugs,
  milestones due today/tomorrow. Skipped when there's nothing to say, and if more than 3 h late.
- **Unblocked**: when an issue's last open blocker is closed.
- With other users: comments on issues you created or commented on, status changes on your issues, and new
  critical/major production bugs. Never for your own actions.

Each type can be switched off. Delivery uses standard Web Push (VAPID); keys are generated on first use and
stored in the database, so the only setting is `VAPID_SUBJECT` (a contact address for push services).
Reminders and digests are checked once a minute by the server process.

## API and the iPhone Share sheet

Settings → **API tokens** creates a personal token (shown once, stored hashed). `POST /api/capture` takes
`{ "text": "quick-add syntax", "content": "<base64 image or text>" }` with `Authorization: Bearer <token>`:
an image is attached, a shared URL becomes a link, other text goes in the description, and without `@app`
it uses the app of your last issue. Settings has step-by-step instructions for an iOS Shortcut that puts
**Add bug** in the Share sheet (iOS doesn't support web-app share targets). Tokens only work for `/api/*`.

## Notification inbox

The header bell shows your unread count. Open it to browse notifications from the last 30 days,
newest first, and load older entries. Clicking an entry opens its destination and marks it read;
**Mark all as read** clears everything through the newest entry shown. Read state is shared across
your devices. The bell refreshes every 30 seconds while the app is visible and when you return to it.

Each notification is saved once per recipient before push delivery, even when push is disabled or
delivery fails. Settings → Notifications controls categories for both the inbox and push. Daily
summaries also work without a push subscription, using the timezone from your browser. Existing
rules still skip notifications about your own comments/status changes. Entries older than 30 days
are hidden immediately and deleted hourly while the server runs. History starts when this feature
is installed; earlier push notifications cannot be recovered.

## Views

- **Issues** (`/`) — table with inline status/priority/type editing, multi-select bulk actions, sortable columns.
  Filters live in the URL so they're bookmarkable: app chips (Shift+click for several), Open/Closed/All or a
  specific status, type, priority, label, overdue, search (`#12` jumps to an id). `/` focuses search.
  Also filter by milestone, severity and environment; the ☑ 2/5 subtask badge lists an issue's subtasks.
  Milestone and size are editable inline.
  100 issues per page (`?page=2`); changing a filter or sort goes back to page 1.
- **Issue** (`/issues/:id`) — description, labels, found-in / fixed-in version, due date, comments, and a
  history of every field change. `Esc` goes back to the list.
  Planning: milestone, size, parent issue (subtasks are one level deep; add them from the parent's page).
  Bugs also get severity and environment. Links (PRs, commits, Sentry, docs) and related issues
  (related to / blocks / blocked by / duplicates / duplicated by, shown on both sides; open blockers mark
  an issue ⛔ blocked in the list).
  Descriptions and comments are Markdown (GitHub style: lists, `- [ ]` checklists, tables, code blocks, links;
  raw HTML is shown as text). Click the description or press `e` to edit; blur or Ctrl+Enter saves.
- **Dashboard** — built around "what do I work on now": In progress (open, not the default status, not
  a status named Blocked), Up next (top priority, not started, not blocked), Fires (critical/major production
  bugs, overdue, due this week, blocked), Quick wins (XS/S), next milestone progress, created vs closed over
  8 weeks, shipped this week, per-app counts and stale issues (untouched 30+ days). Every number links to
  the matching list (`?due=week`, `?blocked=1`, `?size=xs,s` are list filters too).
- **Settings** — custom statuses (order, color, closed flag, default), apps (rename, color, archive) and
  milestones (rename, due date, done, delete).

## Tests

`pnpm test` (quick-add parser, app names, filters, Markdown safety), `pnpm check`, `pnpm lint`.
