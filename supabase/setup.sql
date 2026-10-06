-- Diario de ruta: base de datos, fotos y reglas de acceso.
-- Pegar entero en Supabase → SQL Editor → New query → Run.

-- Quién puede publicar (paradas y fotos). Añade aquí los emails de los viajeros.
create table if not exists public.editores (
  email text primary key
);

create or replace function public.es_editor() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.editores where email = lower(auth.jwt() ->> 'email'));
$$;

create table if not exists public.paradas (
  id uuid primary key default gen_random_uuid(),
  nombre text not null check (char_length(nombre) between 1 and 80),
  lat double precision not null,
  lng double precision not null,
  fecha date,
  hora text,
  nota text check (char_length(nota) <= 2000),
  creado timestamptz not null default now()
);

create table if not exists public.fotos (
  id uuid primary key default gen_random_uuid(),
  parada_id uuid not null references public.paradas(id) on delete cascade,
  ruta text not null,
  pie text check (char_length(pie) <= 500),
  ancho int,
  alto int,
  creado timestamptz not null default now()
);

create table if not exists public.comentarios (
  id uuid primary key default gen_random_uuid(),
  foto_id uuid not null references public.fotos(id) on delete cascade,
  autor text not null check (char_length(autor) between 1 and 40),
  texto text not null check (char_length(texto) between 1 and 1000),
  creado timestamptz not null default now()
);

alter table public.editores enable row level security;
alter table public.paradas enable row level security;
alter table public.fotos enable row level security;
alter table public.comentarios enable row level security;

-- Todo el mundo ve el viaje
create policy "ver paradas" on public.paradas for select using (true);
create policy "ver fotos" on public.fotos for select using (true);
create policy "ver comentarios" on public.comentarios for select using (true);

-- Solo los viajeros publican y editan
create policy "editar paradas" on public.paradas for all using (public.es_editor()) with check (public.es_editor());
create policy "editar fotos" on public.fotos for all using (public.es_editor()) with check (public.es_editor());

-- Cualquiera comenta; solo los viajeros borran comentarios
create policy "comentar" on public.comentarios for insert with check (true);
create policy "borrar comentarios" on public.comentarios for delete using (public.es_editor());

-- Espacio para las fotos: público para ver, solo viajeros suben y borran
insert into storage.buckets (id, name, public) values ('fotos', 'fotos', true)
  on conflict (id) do nothing;
create policy "subir fotos" on storage.objects for insert to authenticated
  with check (bucket_id = 'fotos' and public.es_editor());
create policy "borrar fotos" on storage.objects for delete to authenticated
  using (bucket_id = 'fotos' and public.es_editor());

-- Actualizaciones en directo
alter publication supabase_realtime add table public.paradas, public.fotos, public.comentarios;

-- Viajeros (cambia o añade emails):
insert into public.editores (email) values ('tu-email@ejemplo.com') on conflict do nothing;
