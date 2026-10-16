-- Review tool schema (Supabase project: mu-script).
-- Text only — audio is generated on demand and never stored here.
-- RLS is enabled with no policies, so only the server (service role key) can read/write;
-- the public anon key gets nothing.

create table if not exists public.sets (
    id uuid primary key default gen_random_uuid(),
    name text not null unique,               -- e.g. "C8 R1 – Set 1"
    file_prefix text not null,               -- e.g. "C8-R1-Set1", used in download file names
    created_at timestamptz not null default now()
);

create table if not exists public.scripts (
    id uuid primary key default gen_random_uuid(),
    set_id uuid not null references public.sets (id) on delete cascade,
    position int not null,                   -- order within the set (CSV row order)
    application_number text not null,
    student_name text not null,
    original_text text not null,             -- exact CSV text
    sentences jsonb not null,                -- [{ "original", "spoken", "paragraph", "seed", "prev_context"?, "next_context"? }]
    nouns jsonb not null default '[]',       -- [{ "term", "kind", "options": [{ "text", "label" }] }] — prepared fix options
    status text not null default 'pending' check (status in ('pending', 'in_review', 'approved')),
    approved_at timestamptz,
    updated_at timestamptz not null default now(),
    unique (set_id, application_number)
);

create index if not exists scripts_set_position_idx on public.scripts (set_id, position);

create table if not exists public.pronunciation_library (
    id uuid primary key default gen_random_uuid(),
    term text not null unique,               -- as written in scripts, e.g. "Vidhi"
    spoken text not null,                    -- what to send to ElevenLabs, e.g. "विधि"
    kind text,                               -- person | org | acronym | other
    source_script_id uuid references public.scripts (id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

alter table public.sets enable row level security;
alter table public.scripts enable row level security;
alter table public.pronunciation_library enable row level security;

-- Migration (2026-10-09): prepared spelling options per script.
alter table public.scripts add column if not exists nouns jsonb not null default '[]';

-- Migration (2026-10-10): append-only log of everything reviewers do, for analysis before each new set.
-- Rows are never updated. A take is "kept" when a fix/edit row references its take_id.
create table if not exists public.sentence_changes (
    id bigint generated always as identity primary key,
    created_at timestamptz not null default now(),
    set_id uuid references public.sets (id) on delete set null,
    set_name text,
    script_id uuid references public.scripts (id) on delete set null,
    application_number text not null,
    sentence_index int,                      -- 0-based position at the time of the change
    action text not null check (action in ('take', 'fix', 'edit', 'delete', 'undo')),
    before_original text,                    -- text reviewers read, before
    before_spoken text,                      -- text sent to ElevenLabs, before
    after_original text,
    after_spoken text,
    take_id uuid,                            -- take rows: the attempt; fix/edit rows: the take that was kept
    seed int,
    library_term text,                       -- library entry saved with this change, if any
    library_spoken text,
    reviewer text
);

create index if not exists sentence_changes_script_idx on public.sentence_changes (script_id, created_at);
create index if not exists sentence_changes_set_idx on public.sentence_changes (set_name, created_at);
alter table public.sentence_changes enable row level security;
