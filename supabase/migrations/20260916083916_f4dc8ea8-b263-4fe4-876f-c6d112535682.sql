create extension if not exists vector;

-- profiles
create table public.profiles (
  id uuid primary key,
  email text,
  display_name text,
  created_at timestamptz not null default now()
);
grant select, insert, update on public.profiles to authenticated;
grant all on public.profiles to service_role;
alter table public.profiles enable row level security;
create policy "own profile read" on public.profiles for select to authenticated using (id = auth.uid());
create policy "own profile insert" on public.profiles for insert to authenticated with check (id = auth.uid());
create policy "own profile update" on public.profiles for update to authenticated using (id = auth.uid());

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, display_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email,'@',1)))
  on conflict (id) do nothing;
  return new;
end; $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- raw scraped payloads (global, admin/server owned)
create table public.raw_listings (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  source_listing_id text,
  source_url text not null,
  raw_text text not null,
  content_hash text not null unique,
  scraped_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  is_active boolean not null default true
);
grant select on public.raw_listings to authenticated;
grant all on public.raw_listings to service_role;
alter table public.raw_listings enable row level security;
create policy "raw listings readable" on public.raw_listings for select to authenticated using (true);

-- structured listings
create table public.listings (
  id uuid primary key default gen_random_uuid(),
  raw_listing_id uuid not null unique references public.raw_listings(id) on delete cascade,
  source text not null,
  source_url text not null,
  title text,
  company text,
  location text,
  remote_ok boolean,
  stipend text,
  required_skills text[] not null default '{}',
  experience_level text,
  deadline date,
  description text,
  apply_url text,
  embedding vector(3072),
  extraction_status text not null default 'pending',
  extraction_error text,
  raw_response text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  is_active boolean not null default true
);
grant select on public.listings to authenticated;
grant all on public.listings to service_role;
alter table public.listings enable row level security;
create policy "listings readable" on public.listings for select to authenticated using (true);
create index listings_embedding_idx on public.listings using hnsw ((embedding::halfvec(3072)) halfvec_cosine_ops);
create index listings_deadline_idx on public.listings (deadline);

-- change log for Nexus Radar
create table public.listing_changes (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id) on delete cascade,
  change_type text not null,
  details jsonb not null default '{}'::jsonb,
  detected_at timestamptz not null default now()
);
grant select on public.listing_changes to authenticated;
grant all on public.listing_changes to service_role;
alter table public.listing_changes enable row level security;
create policy "changes readable" on public.listing_changes for select to authenticated using (true);

-- resumes
create table public.resumes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  filename text,
  raw_text text not null,
  char_count int not null default 0,
  embedding vector(3072),
  skills text[] not null default '{}',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.resumes to authenticated;
grant all on public.resumes to service_role;
alter table public.resumes enable row level security;
create policy "own resumes" on public.resumes for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- matches
create table public.matches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  resume_id uuid not null references public.resumes(id) on delete cascade,
  listing_id uuid not null references public.listings(id) on delete cascade,
  score double precision not null,
  justification text,
  created_at timestamptz not null default now(),
  unique (resume_id, listing_id)
);
grant select, insert, update, delete on public.matches to authenticated;
grant all on public.matches to service_role;
alter table public.matches enable row level security;
create policy "own matches" on public.matches for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- shortlist
create table public.shortlist (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  listing_id uuid not null references public.listings(id) on delete cascade,
  note text,
  created_at timestamptz not null default now(),
  unique (user_id, listing_id)
);
grant select, insert, update, delete on public.shortlist to authenticated;
grant all on public.shortlist to service_role;
alter table public.shortlist enable row level security;
create policy "own shortlist" on public.shortlist for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- async jobs (LaunchKit / Radar)
create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  kind text not null,
  status text not null default 'queued',
  payload jsonb not null default '{}'::jsonb,
  result jsonb,
  error text,
  attempts int not null default 0,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);
grant select, insert, update, delete on public.jobs to authenticated;
grant all on public.jobs to service_role;
alter table public.jobs enable row level security;
create policy "own jobs" on public.jobs for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- agent chat
create table public.agent_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid(),
  role text not null,
  content text not null,
  tool_trace jsonb,
  created_at timestamptz not null default now()
);
grant select, insert, delete on public.agent_messages to authenticated;
grant all on public.agent_messages to service_role;
alter table public.agent_messages enable row level security;
create policy "own messages" on public.agent_messages for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- LLM call accounting
create table public.llm_calls (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  task text not null,
  model text,
  ok boolean not null default true,
  detail text,
  created_at timestamptz not null default now()
);
grant select on public.llm_calls to authenticated;
grant all on public.llm_calls to service_role;
alter table public.llm_calls enable row level security;
create policy "own llm calls" on public.llm_calls for select to authenticated using (user_id = auth.uid());

-- semantic search
create or replace function public.match_listings(
  query_embedding vector(3072),
  match_count int default 20,
  min_similarity double precision default 0
)
returns table (
  id uuid, title text, company text, location text, remote_ok boolean,
  stipend text, required_skills text[], experience_level text, deadline date,
  apply_url text, source text, source_url text, description text, similarity double precision
)
language sql stable security definer set search_path = public as $$
  select l.id, l.title, l.company, l.location, l.remote_ok, l.stipend,
         l.required_skills, l.experience_level, l.deadline, l.apply_url,
         l.source, l.source_url, l.description,
         1 - (l.embedding::halfvec(3072) <=> query_embedding::halfvec(3072)) as similarity
  from public.listings l
  where l.embedding is not null and l.is_active and l.extraction_status = 'done'
    and 1 - (l.embedding::halfvec(3072) <=> query_embedding::halfvec(3072)) >= min_similarity
  order by l.embedding::halfvec(3072) <=> query_embedding::halfvec(3072)
  limit match_count;
$$;
grant execute on function public.match_listings(vector, int, double precision) to authenticated, service_role;