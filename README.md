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

| Token                                          | Meaning                                                                      |
| ---------------------------------------------- | ---------------------------------------------------------------------------- |
| `bug:` `feat:` `task:` `imp:`                  | type (falls back to the type picker on the left)                             |
| `@app`                                         | app; repeat for a copy in each app, linked as related; new names are created |
| `!urgent` `!high` `!normal` `!low` / `!0`–`!3` | priority (default normal)                                                    |
| `+label`                                       | labels                                                                       |
| `^v1.3`                                        | milestone (created if new)                                                   |
| `~xs` `~s` `~m` `~l` `~xl`                     | size                                                                         |
| `*fri` `*tomorrow` `*2w` `*nov5` `*2026-11-05` | due date (weekdays mean the next one, never today)                           |
| `-- text`                                      | description                                                                  |

Without `@app`, the app picker on the right is used (remembered per browser). Choose **Inbox (no app)**
to capture without organizing; this is the default on the Inbox page and when no app has been chosen yet.
Typing `@`, `^`, `+` or `*`
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
it goes to Inbox (or pass an explicit `app` in the JSON). Settings has step-by-step instructions for an iOS Shortcut that puts
**Add bug** in the Share sheet (iOS doesn't support web-app share targets). Tokens only work for `/api/*`.

## Claude Code (MCP)

`/api/mcp` is an MCP server (streamable HTTP, stateless, authenticated with an API token). Add it once, for
every project:

```sh
claude mcp add --scope user --transport http bugs https://bugs.example.com/api/mcp \
  --header "Authorization: Bearer bt_…"
```

Settings → API tokens shows the command with your URL. Tools: `list_issues` (full-text search and filters),
`get_issue`, `create_issue` (quick-add syntax in the title works), `update_issue`, `add_comment`,
`close_issue` (with an optional closing comment and fixed-in version). `get_issue` returns everything on the
issue: fields, description, comments, history, links, relations, subtasks and attachments. Screenshots
(PNG/JPEG/GIF/WebP up to 3.5 MB, at most 10) come back as images and logs/JSON/code as text (the last
100k characters), so "find the root cause of #123" works without copy-pasting. Other files (video, PDF, HEIC)
get a 5-minute download link. Everything is done as the token's user and shows up in the history.

## Backups

Every night (first scheduler tick after 00:00 UTC) the server runs `pg_dump --format=custom` and stores the
dump in the attachments bucket as `<S3_PREFIX>backups/YYYY-MM-DD.dump`, deleting dumps older than
`BACKUP_KEEP_DAYS` (default 30; `0` turns backups off). Needs S3. Settings → **Backups** (admins) shows
the last backup and any error, and has **Back up now**. A failed nightly run is retried the next night.

`pg_dump`'s major version must match the server's. The Docker image includes the Postgres 18 client.
Running `pnpm start` with Postgres in podman, set `PG_DUMP=podman exec postgres-18 pg_dump`.

Restore into an empty (or existing, with `--clean`) database:

```sh
pg_restore --clean --if-exists --no-owner -d "$DATABASE_URL" 2026-10-29.dump
```

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

- **Inbox** (`/?inbox=1`) — captures without an app. Add tasks immediately, then use the app picker
  on each row, the bulk **Move to app…** action, or the issue's App field to organize them later.
  Moving an issue to an app removes it from Inbox; choosing **Inbox (no app)** moves it back.
  The navigation count shows open Inbox issues. Inbox captures also work with attachments, reminders,
  subtasks, Today, meeting capture, API capture, and MCP. API/MCP captures without an app go to Inbox.

- **Today** (top of Dashboard) — your personal, manually ordered focus list. Click ☆ beside an open
  issue in the list or dashboard suggestions, or **Add to Today** on its detail page. Pick 1–3 issues
  (there is no hard limit), drag the handle or use ↑ / ↓ to reorder, and click ✓ to mark an issue Done
  (or the first closed status if there is no Done status). ✕ removes it from Today without changing
  the issue. Unfinished work carries over; closing an issue removes it from everyone's Today list,
  and reopening it does not add it back. Your choices and order sync across devices and do not change
  priorities or due dates.

- **Issues** (`/`) — table with inline status/priority/type editing, multi-select bulk actions, sortable columns.
  Filters live in the URL so they're bookmarkable: app chips (Shift+click for several), Open/Closed/All or a
  specific status, type, priority, label, overdue, search (`#12` jumps to an id). `/` focuses search.
  Search is full text over titles, descriptions and comments (English stemming, so "crashing" finds
  "crashes"; the last word matches as a prefix while you type), best match first unless you sorted.
  **Views**: with filters set, **+ Save view** names the current filters and sort; saved views show as ★
  chips above the apps (per user). Saving under an existing name replaces it; ✕ on the active one deletes it.
  Also filter by milestone, severity and environment; the ☑ 2/5 subtask badge lists an issue's subtasks.
  Milestone and size are editable inline.
  100 issues per page (`?page=2`); changing a filter or sort goes back to page 1.
- **Date range** (Issues filters) — choose **Created**, **Updated**, **Due**, or **Closed**, then set
  **From**, **To**, or both. Both dates are inclusive; a missing bound is unrestricted. Dates use
  the database timezone, consistent with the existing overdue filters. Closed dates only match issues
  with a closing date, so select Closed or All statuses when looking for completed work.
  Date ranges work with other filters, pagination and saved views, and remain in the URL
  (`?date=due&from=2026-11-01&to=2026-11-30`). Invalid dates are ignored; reversed URL bounds are swapped.
- **Issue** (`/issues/:id`) — description, labels, found-in / fixed-in version, due date, comments, and a
  history of every field change. `Esc` goes back to the list.
  Planning: milestone, size, parent issue (subtasks are one level deep; add them from the parent's page).
  **Repeat** (daily, weekly, monthly, quarterly, yearly): closing the issue creates a fresh copy, due one
  interval after the old due date (or today); missed intervals are skipped, so chores never pile up. The
  closed one links to the next in its history; ↻ marks repeating issues in the list.
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
