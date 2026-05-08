-- SUPABASE SCHEMA FINAL - CLEAN MIGRATION TANPA DATA LAMA FIREBASE
-- Jalankan di Supabase SQL Editor sebelum deploy.
-- Model tabel fleksibel: setiap collection aplikasi disimpan sebagai JSONB agar flow React lama tidak perlu diubah.

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

-- Helper role. SECURITY DEFINER dipakai agar policy tidak rekursif saat membaca tabel users.
create or replace function public.current_user_role()
returns text
language sql
security definer
set search_path = public
stable
as $$
  select coalesce((select data->>'role' from public.users where id = auth.uid()::text limit 1), 'guest')
$$;

create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select public.current_user_role() = 'admin'
$$;

create or replace function public.is_seller()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select public.current_user_role() = 'seller'
$$;

-- Bersihkan policy lama sebelum membuat policy final.
do $$
declare r record;
begin
  for r in select schemaname, tablename, policyname from pg_policies where schemaname = 'public' loop
    if r.tablename in ('users','products','orders','reviews','withdrawals','seller_wallets','wallet_transactions','komisi_tagihan','notifications','chats','chat_messages','admin_settings','admin_wallets','admin_commission_transactions') then
      execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
    end if;
  end loop;
end $$;

-- USERS: user bisa membuat/mengubah profil sendiri; admin bisa kelola semua.
create policy users_select on public.users for select using (true);
create policy users_insert on public.users for insert with check (auth.uid() is not null and id = auth.uid()::text);
create policy users_update on public.users for update using (public.is_admin() or id = auth.uid()::text) with check (public.is_admin() or id = auth.uid()::text);
create policy users_delete on public.users for delete using (public.is_admin());

-- PRODUCTS: produk bisa dilihat publik; seller mengelola produknya sendiri; admin bisa semua.
create policy products_select on public.products for select using (true);
create policy products_insert on public.products for insert with check (public.is_admin() or (auth.uid() is not null and data->>'sellerId' = auth.uid()::text));
create policy products_update on public.products for update using (public.is_admin() or data->>'sellerId' = auth.uid()::text) with check (public.is_admin() or data->>'sellerId' = auth.uid()::text);
create policy products_delete on public.products for delete using (public.is_admin() or data->>'sellerId' = auth.uid()::text);

-- ORDERS: buyer/seller terkait dan admin bisa melihat/mengelola order.
create policy orders_select on public.orders for select using (public.is_admin() or data->>'buyerId' = auth.uid()::text or data->>'sellerId' = auth.uid()::text);
create policy orders_insert on public.orders for insert with check (auth.uid() is not null and (data->>'buyerId' = auth.uid()::text or public.is_admin()));
create policy orders_update on public.orders for update using (public.is_admin() or data->>'buyerId' = auth.uid()::text or data->>'sellerId' = auth.uid()::text) with check (public.is_admin() or data->>'buyerId' = auth.uid()::text or data->>'sellerId' = auth.uid()::text);
create policy orders_delete on public.orders for delete using (public.is_admin());

-- REVIEWS: public read; buyer/order owner bisa menulis; admin bisa kelola.
create policy reviews_select on public.reviews for select using (true);
create policy reviews_insert on public.reviews for insert with check (auth.uid() is not null and (data->>'buyerId' = auth.uid()::text or public.is_admin()));
create policy reviews_update on public.reviews for update using (public.is_admin() or data->>'buyerId' = auth.uid()::text) with check (public.is_admin() or data->>'buyerId' = auth.uid()::text);
create policy reviews_delete on public.reviews for delete using (public.is_admin() or data->>'buyerId' = auth.uid()::text);

-- WALLET/WITHDRAWAL/KOMISI: seller terkait dan admin.
create policy withdrawals_select on public.withdrawals for select using (public.is_admin() or data->>'sellerId' = auth.uid()::text);
create policy withdrawals_insert on public.withdrawals for insert with check (auth.uid() is not null and (data->>'sellerId' = auth.uid()::text or public.is_admin()));
create policy withdrawals_update on public.withdrawals for update using (public.is_admin() or data->>'sellerId' = auth.uid()::text) with check (public.is_admin() or data->>'sellerId' = auth.uid()::text);
create policy withdrawals_delete on public.withdrawals for delete using (public.is_admin());

create policy seller_wallets_select on public.seller_wallets for select using (public.is_admin() or data->>'sellerId' = auth.uid()::text or id = auth.uid()::text);
create policy seller_wallets_insert on public.seller_wallets for insert with check (auth.uid() is not null and (id = auth.uid()::text or data->>'sellerId' = auth.uid()::text or public.is_admin()));
create policy seller_wallets_update on public.seller_wallets for update using (public.is_admin() or data->>'sellerId' = auth.uid()::text or id = auth.uid()::text) with check (public.is_admin() or data->>'sellerId' = auth.uid()::text or id = auth.uid()::text);
create policy seller_wallets_delete on public.seller_wallets for delete using (public.is_admin());

create policy wallet_transactions_select on public.wallet_transactions for select using (public.is_admin() or data->>'sellerId' = auth.uid()::text);
create policy wallet_transactions_insert on public.wallet_transactions for insert with check (auth.uid() is not null and (data->>'sellerId' = auth.uid()::text or public.is_admin()));
create policy wallet_transactions_update on public.wallet_transactions for update using (public.is_admin() or data->>'sellerId' = auth.uid()::text) with check (public.is_admin() or data->>'sellerId' = auth.uid()::text);
create policy wallet_transactions_delete on public.wallet_transactions for delete using (public.is_admin());

create policy komisi_tagihan_select on public.komisi_tagihan for select using (public.is_admin() or data->>'sellerId' = auth.uid()::text);
create policy komisi_tagihan_insert on public.komisi_tagihan for insert with check (auth.uid() is not null and (public.is_admin() or data->>'sellerId' = auth.uid()::text));
create policy komisi_tagihan_update on public.komisi_tagihan for update using (public.is_admin() or data->>'sellerId' = auth.uid()::text) with check (public.is_admin() or data->>'sellerId' = auth.uid()::text);
create policy komisi_tagihan_delete on public.komisi_tagihan for delete using (public.is_admin());

-- NOTIFICATIONS: user melihat notif sendiri; notif role admin hanya admin.
create policy notifications_select on public.notifications for select using (public.is_admin() or data->>'userId' = auth.uid()::text or (data->>'role' = public.current_user_role() and auth.uid() is not null));
create policy notifications_insert on public.notifications for insert with check (auth.uid() is not null);
create policy notifications_update on public.notifications for update using (public.is_admin() or data->>'userId' = auth.uid()::text or data->>'role' = public.current_user_role()) with check (public.is_admin() or data->>'userId' = auth.uid()::text or data->>'role' = public.current_user_role());
create policy notifications_delete on public.notifications for delete using (public.is_admin() or data->>'userId' = auth.uid()::text);

-- CHATS: peserta chat dan admin.
create policy chats_select on public.chats for select using (public.is_admin() or data->>'buyerId' = auth.uid()::text or data->>'sellerId' = auth.uid()::text or data->>'adminId' = auth.uid()::text);
create policy chats_insert on public.chats for insert with check (auth.uid() is not null and (public.is_admin() or data->>'buyerId' = auth.uid()::text or data->>'sellerId' = auth.uid()::text or data->>'adminId' = auth.uid()::text));
create policy chats_update on public.chats for update using (public.is_admin() or data->>'buyerId' = auth.uid()::text or data->>'sellerId' = auth.uid()::text or data->>'adminId' = auth.uid()::text) with check (public.is_admin() or data->>'buyerId' = auth.uid()::text or data->>'sellerId' = auth.uid()::text or data->>'adminId' = auth.uid()::text);
create policy chats_delete on public.chats for delete using (public.is_admin());

create policy chat_messages_select on public.chat_messages for select using (public.is_admin() or exists (select 1 from public.chats c where c.id = chat_messages.data->>'chatId' and (c.data->>'buyerId' = auth.uid()::text or c.data->>'sellerId' = auth.uid()::text or c.data->>'adminId' = auth.uid()::text)));
create policy chat_messages_insert on public.chat_messages for insert with check (auth.uid() is not null and (public.is_admin() or data->>'senderId' = auth.uid()::text));
create policy chat_messages_update on public.chat_messages for update using (public.is_admin() or data->>'senderId' = auth.uid()::text) with check (public.is_admin() or data->>'senderId' = auth.uid()::text);
create policy chat_messages_delete on public.chat_messages for delete using (public.is_admin() or data->>'senderId' = auth.uid()::text);

-- ADMIN AREA
create policy admin_settings_select on public.admin_settings for select using (true);
create policy admin_settings_insert on public.admin_settings for insert with check (public.is_admin());
create policy admin_settings_update on public.admin_settings for update using (public.is_admin()) with check (public.is_admin());
create policy admin_settings_delete on public.admin_settings for delete using (public.is_admin());

create policy admin_wallets_select on public.admin_wallets for select using (public.is_admin());
create policy admin_wallets_insert on public.admin_wallets for insert with check (public.is_admin());
create policy admin_wallets_update on public.admin_wallets for update using (public.is_admin()) with check (public.is_admin());
create policy admin_wallets_delete on public.admin_wallets for delete using (public.is_admin());

create policy admin_commission_transactions_select on public.admin_commission_transactions for select using (public.is_admin());
create policy admin_commission_transactions_insert on public.admin_commission_transactions for insert with check (public.is_admin());
create policy admin_commission_transactions_update on public.admin_commission_transactions for update using (public.is_admin()) with check (public.is_admin());
create policy admin_commission_transactions_delete on public.admin_commission_transactions for delete using (public.is_admin());

-- Realtime publication.
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

-- CARA MEMBUAT ADMIN PERTAMA:
-- 1) Buat user di Supabase Auth dashboard.
-- 2) Copy UUID user tersebut.
-- 3) Jalankan contoh ini dengan UUID asli:
-- insert into public.users (id, data) values ('UUID_ADMIN_AUTH', '{"uid":"UUID_ADMIN_AUTH","name":"Admin","email":"admin@email.com","role":"admin","status":"active"}'::jsonb)
-- on conflict (id) do update set data = excluded.data;
