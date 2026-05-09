-- =========================================================
-- UMKM JAMPANG SURADE - SUPABASE SQL FINAL AMAN
-- Untuk fresh database / setup bersih Supabase realtime penuh.
-- Paste semua isi file ini ke Supabase SQL Editor, lalu Run.
-- =========================================================

create extension if not exists pgcrypto;

-- ---------- Helpers ----------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.create_json_table(table_name text)
returns void
language plpgsql
as $$
begin
  execute format(
    'create table if not exists public.%I (
      id text primary key default gen_random_uuid()::text,
      data jsonb not null default ''{}''::jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )',
    table_name
  );

  execute format('drop trigger if exists trg_%I_updated_at on public.%I', table_name, table_name);
  execute format('create trigger trg_%I_updated_at before update on public.%I for each row execute function public.set_updated_at()', table_name, table_name);
  execute format('alter table public.%I enable row level security', table_name);
end;
$$;

-- ---------- Tables ----------
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
select public.create_json_table('payments');
select public.create_json_table('seller_applications');
select public.create_json_table('seller_verifications');
select public.create_json_table('user_presence');
select public.create_json_table('carts');

-- ---------- Useful indexes for JSONB queries used by app ----------
create index if not exists idx_users_email on public.users ((data->>'email'));
create index if not exists idx_users_role on public.users ((data->>'role'));
create index if not exists idx_products_seller on public.products ((data->>'sellerId'));
create index if not exists idx_products_status on public.products ((data->>'status'));
create index if not exists idx_orders_buyer on public.orders ((data->>'buyerId'));
create index if not exists idx_orders_seller on public.orders ((data->>'sellerId'));
create index if not exists idx_orders_status on public.orders ((data->>'status'));
create index if not exists idx_reviews_product on public.reviews ((data->>'productId'));
create index if not exists idx_reviews_buyer on public.reviews ((data->>'buyerId'));
create index if not exists idx_withdrawals_seller on public.withdrawals ((data->>'sellerId'));
create index if not exists idx_wallet_tx_seller on public.wallet_transactions ((data->>'sellerId'));
create index if not exists idx_komisi_seller on public.komisi_tagihan ((data->>'sellerId'));
create index if not exists idx_komisi_order on public.komisi_tagihan ((data->>'orderId'));
create index if not exists idx_notifications_user on public.notifications ((data->>'userId'));
create index if not exists idx_notifications_role on public.notifications ((data->>'role'));
create index if not exists idx_chats_buyer on public.chats ((data->>'buyerId'));
create index if not exists idx_chats_seller on public.chats ((data->>'sellerId'));
create index if not exists idx_chats_admin on public.chats ((data->>'adminId'));
create index if not exists idx_chat_messages_chat on public.chat_messages ((data->>'chatId'));
create index if not exists idx_chat_messages_sender on public.chat_messages ((data->>'senderId'));
create index if not exists idx_payments_order on public.payments ((data->>'orderId'));
create index if not exists idx_payments_user on public.payments ((data->>'userId'));
create index if not exists idx_seller_applications_user on public.seller_applications ((data->>'userId'));
create index if not exists idx_seller_applications_status on public.seller_applications ((data->>'status'));
create index if not exists idx_user_presence_user on public.user_presence ((data->>'userId'));
create index if not exists idx_user_presence_role on public.user_presence ((data->>'role'));
create index if not exists idx_user_presence_online on public.user_presence ((data->>'isOnline'));
create index if not exists idx_carts_user on public.carts ((data->>'userId'));


-- ---------- Role helpers ----------
-- SECURITY DEFINER mencegah policy recursive saat membaca tabel users.
create or replace function public.current_user_role()
returns text
language sql
security definer
set search_path = public
stable
as $$
  select coalesce((select data->>'role' from public.users where id = auth.uid()::text limit 1), 'guest')
$$;

create or replace function public.is_main_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select public.current_user_role() = 'admin'
$$;

create or replace function public.is_admin_staff()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select public.current_user_role() in ('admin', 'sub_admin')
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

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  meta jsonb;
  clean_role text;
begin
  meta := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  clean_role := coalesce(meta->>'role', 'buyer');
  if clean_role not in ('admin','sub_admin','seller','buyer') then
    clean_role := 'buyer';
  end if;

  insert into public.users (id, data)
  values (
    new.id::text,
    jsonb_strip_nulls(
      jsonb_build_object(
        'uid', new.id::text,
        'authUid', new.id::text,
        'email', coalesce(new.email, meta->>'email'),
        'name', coalesce(meta->>'name', split_part(coalesce(new.email,''), '@', 1)),
        'role', clean_role,
        'status', coalesce(meta->>'status', case when clean_role = 'seller' then 'pending' else 'active' end),
        'whatsapp', meta->>'whatsapp',
        'village', meta->>'village',
        'district', meta->>'district',
        'regency', meta->>'regency',
        'detailAddress', meta->>'detailAddress',
        'fullAddress', meta->>'fullAddress',
        'savedShippingAddress', meta->'savedShippingAddress',
        'permissions', meta->'permissions',
        'createdAt', now()
      )
    )
  )
  on conflict (id) do update set
    data = public.users.data || excluded.data,
    updated_at = now();

  if clean_role = 'seller' then
    insert into public.seller_wallets (id, data)
    values (
      new.id::text,
      jsonb_build_object(
        'sellerId', new.id::text,
        'sellerName', coalesce(meta->>'name', split_part(coalesce(new.email,''), '@', 1)),
        'saldoTersedia', 0,
        'saldoTertahan', 0,
        'totalPenjualan', 0,
        'totalDitarik', 0
      )
    )
    on conflict (id) do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();


-- Backward-compatible alias, dipakai policy lama jika masih ada referensi.
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select public.is_main_admin()
$$;

-- ---------- Clean old policies ----------
do $$
declare r record;
begin
  for r in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
  loop
    if r.tablename in (
      'users','products','orders','reviews','withdrawals','seller_wallets','wallet_transactions',
      'komisi_tagihan','notifications','chats','chat_messages','admin_settings','admin_wallets',
      'admin_commission_transactions','payments','seller_applications','seller_verifications','user_presence','carts'
    ) then
      execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
    end if;
  end loop;
end;
$$;

-- =========================================================
-- RLS POLICIES
-- =========================================================

-- USERS
-- Public read dipertahankan karena app menampilkan seller/user dan mencari user by email.
-- Update: user sendiri, admin utama, dan sub_admin untuk approval/blokir seller.
create policy users_select on public.users for select using (true);
create policy users_insert on public.users for insert with check (auth.uid() is not null and id = auth.uid()::text);
create policy users_update on public.users for update
  using (
    public.is_main_admin()
    or id = auth.uid()::text
    or (public.current_user_role() = 'sub_admin' and coalesce(data->>'role','') <> 'admin')
  )
  with check (
    public.is_main_admin()
    or id = auth.uid()::text
    or (public.current_user_role() = 'sub_admin' and coalesce(data->>'role','') <> 'admin')
  );
create policy users_delete on public.users for delete using (public.is_main_admin());

-- PRODUCTS
create policy products_select on public.products for select using (true);
create policy products_insert on public.products for insert with check (
  public.is_admin_staff() or (auth.uid() is not null and data->>'sellerId' = auth.uid()::text)
);
create policy products_update on public.products for update
  using (public.is_admin_staff() or data->>'sellerId' = auth.uid()::text)
  with check (public.is_admin_staff() or data->>'sellerId' = auth.uid()::text);
create policy products_delete on public.products for delete using (public.is_main_admin() or data->>'sellerId' = auth.uid()::text);

-- ORDERS
create policy orders_select on public.orders for select using (
  public.is_admin_staff() or data->>'buyerId' = auth.uid()::text or data->>'sellerId' = auth.uid()::text
);
create policy orders_insert on public.orders for insert with check (
  auth.uid() is not null and (public.is_admin_staff() or data->>'buyerId' = auth.uid()::text)
);
create policy orders_update on public.orders for update
  using (public.is_admin_staff() or data->>'buyerId' = auth.uid()::text or data->>'sellerId' = auth.uid()::text)
  with check (public.is_admin_staff() or data->>'buyerId' = auth.uid()::text or data->>'sellerId' = auth.uid()::text);
create policy orders_delete on public.orders for delete using (public.is_main_admin());

-- REVIEWS
create policy reviews_select on public.reviews for select using (true);
create policy reviews_insert on public.reviews for insert with check (
  auth.uid() is not null and (public.is_admin_staff() or data->>'buyerId' = auth.uid()::text)
);
create policy reviews_update on public.reviews for update
  using (public.is_admin_staff() or data->>'buyerId' = auth.uid()::text)
  with check (public.is_admin_staff() or data->>'buyerId' = auth.uid()::text);
create policy reviews_delete on public.reviews for delete using (public.is_admin_staff() or data->>'buyerId' = auth.uid()::text);

-- WITHDRAWALS / WALLETS / COMMISSION
create policy withdrawals_select on public.withdrawals for select using (public.is_admin_staff() or data->>'sellerId' = auth.uid()::text);
create policy withdrawals_insert on public.withdrawals for insert with check (auth.uid() is not null and (public.is_admin_staff() or data->>'sellerId' = auth.uid()::text));
create policy withdrawals_update on public.withdrawals for update using (public.is_admin_staff() or data->>'sellerId' = auth.uid()::text) with check (public.is_admin_staff() or data->>'sellerId' = auth.uid()::text);
create policy withdrawals_delete on public.withdrawals for delete using (public.is_main_admin());

create policy seller_wallets_select on public.seller_wallets for select using (public.is_admin_staff() or data->>'sellerId' = auth.uid()::text or id = auth.uid()::text);
create policy seller_wallets_insert on public.seller_wallets for insert with check (auth.uid() is not null and (public.is_admin_staff() or id = auth.uid()::text or data->>'sellerId' = auth.uid()::text));
create policy seller_wallets_update on public.seller_wallets for update using (public.is_admin_staff() or data->>'sellerId' = auth.uid()::text or id = auth.uid()::text) with check (public.is_admin_staff() or data->>'sellerId' = auth.uid()::text or id = auth.uid()::text);
create policy seller_wallets_delete on public.seller_wallets for delete using (public.is_main_admin());

create policy wallet_transactions_select on public.wallet_transactions for select using (public.is_admin_staff() or data->>'sellerId' = auth.uid()::text);
create policy wallet_transactions_insert on public.wallet_transactions for insert with check (auth.uid() is not null and (public.is_admin_staff() or data->>'sellerId' = auth.uid()::text));
create policy wallet_transactions_update on public.wallet_transactions for update using (public.is_admin_staff() or data->>'sellerId' = auth.uid()::text) with check (public.is_admin_staff() or data->>'sellerId' = auth.uid()::text);
create policy wallet_transactions_delete on public.wallet_transactions for delete using (public.is_main_admin());

create policy komisi_tagihan_select on public.komisi_tagihan for select using (public.is_admin_staff() or data->>'sellerId' = auth.uid()::text);
create policy komisi_tagihan_insert on public.komisi_tagihan for insert with check (auth.uid() is not null and (public.is_admin_staff() or data->>'sellerId' = auth.uid()::text));
create policy komisi_tagihan_update on public.komisi_tagihan for update using (public.is_admin_staff() or data->>'sellerId' = auth.uid()::text) with check (public.is_admin_staff() or data->>'sellerId' = auth.uid()::text);
create policy komisi_tagihan_delete on public.komisi_tagihan for delete using (public.is_main_admin());

-- NOTIFICATIONS
create policy notifications_select on public.notifications for select using (
  public.is_admin_staff()
  or data->>'userId' = auth.uid()::text
  or (auth.uid() is not null and data->>'role' = public.current_user_role())
);
create policy notifications_insert on public.notifications for insert with check (auth.uid() is not null);
create policy notifications_update on public.notifications for update
  using (public.is_admin_staff() or data->>'userId' = auth.uid()::text or data->>'role' = public.current_user_role())
  with check (public.is_admin_staff() or data->>'userId' = auth.uid()::text or data->>'role' = public.current_user_role());
create policy notifications_delete on public.notifications for delete using (public.is_admin_staff() or data->>'userId' = auth.uid()::text);

-- CHATS
create policy chats_select on public.chats for select using (
  public.is_admin_staff() or data->>'buyerId' = auth.uid()::text or data->>'sellerId' = auth.uid()::text or data->>'adminId' = auth.uid()::text
);
create policy chats_insert on public.chats for insert with check (
  auth.uid() is not null and (public.is_admin_staff() or data->>'buyerId' = auth.uid()::text or data->>'sellerId' = auth.uid()::text or data->>'adminId' = auth.uid()::text)
);
create policy chats_update on public.chats for update
  using (public.is_admin_staff() or data->>'buyerId' = auth.uid()::text or data->>'sellerId' = auth.uid()::text or data->>'adminId' = auth.uid()::text)
  with check (public.is_admin_staff() or data->>'buyerId' = auth.uid()::text or data->>'sellerId' = auth.uid()::text or data->>'adminId' = auth.uid()::text);
create policy chats_delete on public.chats for delete using (public.is_main_admin());

create policy chat_messages_select on public.chat_messages for select using (
  public.is_admin_staff()
  or exists (
    select 1 from public.chats c
    where c.id = chat_messages.data->>'chatId'
      and (c.data->>'buyerId' = auth.uid()::text or c.data->>'sellerId' = auth.uid()::text or c.data->>'adminId' = auth.uid()::text)
  )
);
create policy chat_messages_insert on public.chat_messages for insert with check (
  auth.uid() is not null and (public.is_admin_staff() or data->>'senderId' = auth.uid()::text)
);
create policy chat_messages_update on public.chat_messages for update
  using (public.is_admin_staff() or data->>'senderId' = auth.uid()::text)
  with check (public.is_admin_staff() or data->>'senderId' = auth.uid()::text);
create policy chat_messages_delete on public.chat_messages for delete using (public.is_admin_staff() or data->>'senderId' = auth.uid()::text);


-- PAYMENTS
create policy payments_select on public.payments for select using (
  public.is_admin_staff() or data->>'userId' = auth.uid()::text or data->>'buyerId' = auth.uid()::text or data->>'sellerId' = auth.uid()::text
);
create policy payments_insert on public.payments for insert with check (auth.uid() is not null);
create policy payments_update on public.payments for update using (public.is_admin_staff() or data->>'userId' = auth.uid()::text) with check (public.is_admin_staff() or data->>'userId' = auth.uid()::text);
create policy payments_delete on public.payments for delete using (public.is_main_admin());

-- SELLER APPLICATIONS / VERIFICATIONS
create policy seller_applications_select on public.seller_applications for select using (public.is_admin_staff() or data->>'userId' = auth.uid()::text or data->>'sellerId' = auth.uid()::text);
create policy seller_applications_insert on public.seller_applications for insert with check (auth.uid() is not null and (data->>'userId' = auth.uid()::text or data->>'sellerId' = auth.uid()::text or public.is_admin_staff()));
create policy seller_applications_update on public.seller_applications for update using (public.is_admin_staff() or data->>'userId' = auth.uid()::text or data->>'sellerId' = auth.uid()::text) with check (public.is_admin_staff() or data->>'userId' = auth.uid()::text or data->>'sellerId' = auth.uid()::text);
create policy seller_applications_delete on public.seller_applications for delete using (public.is_main_admin());

create policy seller_verifications_select on public.seller_verifications for select using (public.is_admin_staff() or data->>'userId' = auth.uid()::text or data->>'sellerId' = auth.uid()::text);
create policy seller_verifications_insert on public.seller_verifications for insert with check (auth.uid() is not null and (data->>'userId' = auth.uid()::text or data->>'sellerId' = auth.uid()::text or public.is_admin_staff()));
create policy seller_verifications_update on public.seller_verifications for update using (public.is_admin_staff() or data->>'userId' = auth.uid()::text or data->>'sellerId' = auth.uid()::text) with check (public.is_admin_staff() or data->>'userId' = auth.uid()::text or data->>'sellerId' = auth.uid()::text);
create policy seller_verifications_delete on public.seller_verifications for delete using (public.is_main_admin());

-- USER PRESENCE: untuk login/logout online-offline realtime
create policy user_presence_select on public.user_presence for select using (auth.uid() is not null);
create policy user_presence_insert on public.user_presence for insert with check (auth.uid() is not null and (id = auth.uid()::text or data->>'userId' = auth.uid()::text or public.is_admin_staff()));
create policy user_presence_update on public.user_presence for update using (auth.uid() is not null and (id = auth.uid()::text or data->>'userId' = auth.uid()::text or public.is_admin_staff())) with check (auth.uid() is not null and (id = auth.uid()::text or data->>'userId' = auth.uid()::text or public.is_admin_staff()));
create policy user_presence_delete on public.user_presence for delete using (public.is_main_admin() or id = auth.uid()::text);

-- ADMIN AREA
-- Settings dapat dibaca publik karena app perlu menampilkan informasi pembayaran/setting.
-- Ubah hanya admin utama.
create policy admin_settings_select on public.admin_settings for select using (true);
create policy admin_settings_insert on public.admin_settings for insert with check (public.is_main_admin());
create policy admin_settings_update on public.admin_settings for update using (public.is_main_admin()) with check (public.is_main_admin());
create policy admin_settings_delete on public.admin_settings for delete using (public.is_main_admin());

create policy admin_wallets_select on public.admin_wallets for select using (public.is_admin_staff());
create policy admin_wallets_insert on public.admin_wallets for insert with check (public.is_main_admin());
create policy admin_wallets_update on public.admin_wallets for update using (public.is_main_admin()) with check (public.is_main_admin());
create policy admin_wallets_delete on public.admin_wallets for delete using (public.is_main_admin());

create policy admin_commission_transactions_select on public.admin_commission_transactions for select using (public.is_admin_staff());
create policy admin_commission_transactions_insert on public.admin_commission_transactions for insert with check (public.is_admin_staff());
create policy admin_commission_transactions_update on public.admin_commission_transactions for update using (public.is_admin_staff()) with check (public.is_admin_staff());
create policy admin_commission_transactions_delete on public.admin_commission_transactions for delete using (public.is_main_admin());


-- CARTS
create policy carts_select on public.carts for select
using (public.is_admin_staff() or id = auth.uid()::text or data->>'userId' = auth.uid()::text);

create policy carts_insert on public.carts for insert
with check (auth.uid() is not null and (id = auth.uid()::text or data->>'userId' = auth.uid()::text or public.is_admin_staff()));

create policy carts_update on public.carts for update
using (public.is_admin_staff() or id = auth.uid()::text or data->>'userId' = auth.uid()::text)
with check (public.is_admin_staff() or id = auth.uid()::text or data->>'userId' = auth.uid()::text);

create policy carts_delete on public.carts for delete
using (public.is_admin_staff() or id = auth.uid()::text or data->>'userId' = auth.uid()::text);

-- ---------- Realtime publication ----------
do $$
declare t text;
begin
  foreach t in array array[
    'users','products','orders','reviews','withdrawals','seller_wallets','wallet_transactions',
    'komisi_tagihan','notifications','chats','chat_messages','admin_settings','admin_wallets',
    'admin_commission_transactions','payments','seller_applications','seller_verifications','user_presence','carts'
  ] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception
      when duplicate_object then null;
      when undefined_object then null;
    end;
  end loop;
end;
$$;

-- ---------- Default records agar app tidak kosong/error ----------
insert into public.admin_settings (id, data) values
('commission', '{"globalCommissionPercent":10,"productApprovalRequired":true}'::jsonb),
('payment', '{"bankName":"","accountNumber":"","accountName":"","qrisUrl":""}'::jsonb),
('manualBalance', '{"totalSellerBalanceManual":0,"isManualBalanceActive":false}'::jsonb)
on conflict (id) do nothing;

insert into public.admin_wallets (id, data) values
('commission', '{"balance":0,"totalCommission":0,"updatedAt":null}'::jsonb),
('main', '{"balance":0,"totalCommission":0,"updatedAt":null}'::jsonb)
on conflict (id) do nothing;

-- =========================================================
-- CARA MEMBUAT ADMIN PERTAMA
-- 1. Buat user admin di Supabase Dashboard > Authentication > Users.
-- 2. Copy UUID user admin tersebut.
-- 3. Ganti UUID_ADMIN_AUTH dan email di bawah, lalu jalankan baris insert ini.
--
-- insert into public.users (id, data)
-- values (
--   'UUID_ADMIN_AUTH',
--   '{"uid":"UUID_ADMIN_AUTH","name":"Admin","email":"admin@email.com","role":"admin","status":"active"}'::jsonb
-- )
-- on conflict (id) do update set data = excluded.data;
-- =========================================================
