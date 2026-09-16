revoke all on function public.handle_new_user() from public, anon, authenticated;

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
language sql stable security invoker set search_path = public as $$
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
revoke all on function public.match_listings(vector, int, double precision) from public, anon;
grant execute on function public.match_listings(vector, int, double precision) to authenticated, service_role;