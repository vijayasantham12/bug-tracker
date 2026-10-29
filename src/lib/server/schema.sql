create table if not exists apps (
	id serial primary key,
	name text not null,
	color text not null default '#64748b',
	archived boolean not null default false,
	created_at timestamptz not null default now()
);
create unique index if not exists apps_name_lower on apps (lower(name));
-- lowercase, no spaces (see src/lib/appname.ts). NOT VALID: checks new/renamed apps, not old rows.
do $$ begin
	alter table apps add constraint apps_name_format
		check (name ~ '^[a-z0-9][a-z0-9._-]{0,39}$') not valid;
exception when duplicate_object then null;
end $$;

create table if not exists statuses (
	id serial primary key,
	name text not null unique,
	color text not null default '#64748b',
	position int not null default 0,
	is_closed boolean not null default false,
	is_default boolean not null default false
);

create table if not exists issues (
	id serial primary key,
	app_id int references apps (id) on delete restrict,
	type text not null default 'bug' check (type in ('bug', 'feature', 'task', 'improvement')),
	title text not null,
	description text not null default '',
	status_id int not null references statuses (id) on delete restrict,
	-- 0 urgent, 1 high, 2 normal, 3 low
	priority smallint not null default 2 check (priority between 0 and 3),
	labels text[] not null default '{}',
	version text,
	fixed_in text,
	due_date date,
	created_at timestamptz not null default now(),
	updated_at timestamptz not null default now(),
	closed_at timestamptz
);
create index if not exists issues_app on issues (app_id);
create index if not exists issues_status on issues (status_id);
create index if not exists issues_labels on issues using gin (labels);

-- Unorganized captures live in Inbox until assigned to an app.
alter table issues alter column app_id drop not null;

-- comments and field-change history
create table if not exists issue_events (
	id serial primary key,
	issue_id int not null references issues (id) on delete cascade,
	kind text not null check (kind in ('comment', 'change')),
	field text,
	old_value text,
	new_value text,
	body text,
	created_at timestamptz not null default now()
);
create index if not exists issue_events_issue on issue_events (issue_id, created_at);

insert into statuses (name, color, position, is_closed, is_default)
select * from (values
	('Open', '#3b82f6', 0, false, true),
	('In Progress', '#f59e0b', 1, false, false),
	('Blocked', '#ef4444', 2, false, false),
	('Testing', '#8b5cf6', 3, false, false),
	('Done', '#22c55e', 4, true, false),
	('Won''t Fix', '#94a3b8', 5, true, false)
) as s
where not exists (select 1 from statuses);

-- metadata only; file bodies live in S3 under `key`
create table if not exists attachments (
	id serial primary key,
	issue_id int not null references issues (id) on delete cascade,
	filename text not null,
	mime text not null,
	size int not null,
	key text not null,
	created_at timestamptz not null default now()
);
create index if not exists attachments_issue on attachments (issue_id);

-- auth
create table if not exists users (
	id serial primary key,
	email text not null,
	name text not null,
	password_hash text not null,
	role text not null default 'member' check (role in ('admin', 'member')),
	created_at timestamptz not null default now()
);
create unique index if not exists users_email_lower on users (lower(email));

-- id is sha256(token); the raw token only lives in the cookie
create table if not exists sessions (
	id text primary key,
	user_id int not null references users (id) on delete cascade,
	expires_at timestamptz not null
);
create index if not exists sessions_user on sessions (user_id);

create table if not exists invites (
	id serial primary key,
	token_hash text not null unique,
	email text,
	role text not null default 'member' check (role in ('admin', 'member')),
	created_by int references users (id) on delete set null,
	created_at timestamptz not null default now(),
	expires_at timestamptz not null,
	used_at timestamptz
);

alter table issues add column if not exists created_by int references users (id) on delete set null;
alter table issue_events add column if not exists user_id int references users (id) on delete set null;

-- planning: milestones (target releases), subtasks, size; bug details: severity, environment
create table if not exists milestones (
	id serial primary key,
	name text not null,
	due_date date,
	done boolean not null default false,
	created_at timestamptz not null default now()
);
create unique index if not exists milestones_name_lower on milestones (lower(name));

alter table issues add column if not exists milestone_id int references milestones (id) on delete set null;
-- one level only (enforced in repo.ts): a subtask can't have subtasks
alter table issues add column if not exists parent_id int references issues (id) on delete set null;
alter table issues add column if not exists size text check (size in ('xs', 's', 'm', 'l', 'xl'));
alter table issues add column if not exists severity text
	check (severity in ('critical', 'major', 'minor', 'trivial'));
alter table issues add column if not exists environment text
	check (environment in ('production', 'staging', 'local'));
create index if not exists issues_milestone on issues (milestone_id);
create index if not exists issues_parent on issues (parent_id);

create table if not exists issue_links (
	id serial primary key,
	issue_id int not null references issues (id) on delete cascade,
	url text not null,
	title text,
	created_at timestamptz not null default now()
);
create index if not exists issue_links_issue on issue_links (issue_id);

-- directed: from_id duplicates / blocks to_id; 'relates' is stored once, either way round
create table if not exists issue_relations (
	id serial primary key,
	from_id int not null references issues (id) on delete cascade,
	to_id int not null references issues (id) on delete cascade,
	kind text not null check (kind in ('relates', 'duplicates', 'blocks')),
	created_at timestamptz not null default now(),
	check (from_id <> to_id),
	unique (from_id, to_id, kind)
);
create index if not exists issue_relations_to on issue_relations (to_id);

-- personal API tokens (Authorization: Bearer …), e.g. for the iOS Shortcut; only the hash is stored
create table if not exists api_tokens (
	id serial primary key,
	user_id int not null references users (id) on delete cascade,
	name text not null,
	token_hash text not null unique,
	created_at timestamptz not null default now(),
	last_used_at timestamptz
);

-- ---------- push notifications ----------

-- server-wide values generated on first use, e.g. the VAPID key pair for Web Push
create table if not exists app_settings (
	key text primary key,
	value text not null
);

-- one row per browser/device that turned notifications on
create table if not exists push_subscriptions (
	id serial primary key,
	user_id int not null references users (id) on delete cascade,
	endpoint text not null unique,
	p256dh text not null,
	auth text not null,
	device text,
	created_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user on push_subscriptions (user_id);

-- which notifications a user wants (see NotifyPrefs in src/lib/types.ts), their timezone for the
-- daily digest, and the local date the last digest went out
alter table users add column if not exists notify jsonb not null default '{}';
alter table users add column if not exists timezone text;
alter table users add column if not exists last_digest_on date;

-- "remind me" on an issue: sent to remind_user_id at remind_at, then cleared
alter table issues add column if not exists remind_at timestamptz;
alter table issues add column if not exists remind_user_id int references users (id) on delete set null;
create index if not exists issues_remind_at on issues (remind_at) where remind_at is not null;

-- One inbox entry per recipient and occurrence, independent of push devices/delivery.
create table if not exists notifications (
	id serial primary key,
	user_id int not null references users (id) on delete cascade,
	kind text,
	title text not null,
	body text not null,
	url text not null,
	created_at timestamptz not null default now(),
	read_at timestamptz
);
create index if not exists notifications_user_id on notifications (user_id, id desc);
create index if not exists notifications_unread on notifications (user_id, created_at)
	where read_at is null;
create index if not exists notifications_created on notifications (created_at);

-- Personal focus queue. Unfinished work carries over until completed or removed.
create table if not exists today_issues (
	user_id int not null references users (id) on delete cascade,
	issue_id int not null references issues (id) on delete cascade,
	position int not null,
	primary key (user_id, issue_id)
);
create index if not exists today_issues_issue on today_issues (issue_id);

-- ---------- full-text search ----------

-- title weighs more than description; 'english' so "crashes" finds "crash"
alter table issues add column if not exists search tsvector generated always as (
	setweight(to_tsvector('english'::regconfig, title), 'A') ||
	setweight(to_tsvector('english'::regconfig, description), 'B')
) stored;
create index if not exists issues_search on issues using gin (search);
create index if not exists issue_events_comment_search on issue_events
	using gin (to_tsvector('english'::regconfig, body)) where kind = 'comment';

-- ---------- saved views: named list URLs, per user ----------

create table if not exists saved_views (
	id serial primary key,
	user_id int not null references users (id) on delete cascade,
	name text not null,
	-- the list's query string, e.g. "?app=shop&env=production"
	query text not null,
	created_at timestamptz not null default now()
);
create unique index if not exists saved_views_user_name on saved_views (user_id, lower(name));

-- ---------- recurring issues ----------

-- closing a repeating issue creates the next one (see spawnRepeats in repo.ts)
alter table issues add column if not exists repeat text
	check (repeat in ('daily', 'weekly', 'monthly', 'quarterly', 'yearly'));
