-- Jalankan file ini di Supabase: SQL Editor -> New query -> paste semua -> Run.
-- Skema ini sengaja aman/fleksibel: data aplikasi disimpan sebagai JSONB agar field lama dari Firebase tidak rusak.

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create or replace function public.create_json_table(table_name text)
returns void language plpgsql as $$
begin
  execute format('create table if not exists public.%I (id text primary key default gen_random_uuid()::text, data jsonb not null default ''{}''::jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now())', table_name);
  execute format('drop trigger if exists trg_%I_updated_at on public.%I', table_name, table_name);
  execute format('create trigger trg_%I_updated_at before update on public.%I for each row execute function public.set_updated_at()', table_name, table_name);
  execute format('alter table public.%I enable row level security', table_name);
  execute format('drop policy if exists "%I_select" on public.%I', table_name, table_name);
  execute format('drop policy if exists "%I_insert" on public.%I', table_name, table_name);
  execute format('drop policy if exists "%I_update" on public.%I', table_name, table_name);
  execute format('drop policy if exists "%I_delete" on public.%I', table_name, table_name);
  execute format('create policy "%I_select" on public.%I for select using (true)', table_name, table_name);
  execute format('create policy "%I_insert" on public.%I for insert with check (true)', table_name, table_name);
  execute format('create policy "%I_update" on public.%I for update using (true) with check (true)', table_name, table_name);
  execute format('create policy "%I_delete" on public.%I for delete using (true)', table_name, table_name);
end $$;

select public.create_json_table('users');
select public.create_json_table('products');
select public.create_json_table('orders');
select public.create_json_table('reviews');
select public.create_json_table('withdrawals');
select public.create_json_table('seller_wallets');
select public.create_json_table('wallet_transactions');
select public.create_json_table('komisi_tagihan');
select public.create_json_table('notifications');
select public.create_json_table('chats');
select public.create_json_table('chat_messages');
select public.create_json_table('admin_settings');
select public.create_json_table('admin_wallets');
select public.create_json_table('admin_commission_transactions');

-- Supabase Realtime: aktifkan publikasi untuk tabel aplikasi.
do $$
declare t text;
begin
  foreach t in array array['users','products','orders','reviews','withdrawals','seller_wallets','wallet_transactions','komisi_tagihan','notifications','chats','chat_messages','admin_settings','admin_wallets','admin_commission_transactions'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;
