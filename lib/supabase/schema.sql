-- Enable required extensions
create extension if not exists pgcrypto;
create extension if not exists citext;

-- Categories table to store LEED v5 BD+C categories
create table if not exists public.categories (
  id text primary key,
  name text not null,
  description text not null,
  max_points integer not null,
  levels text[] not null,
  strategies text not null,
  icon_key text not null,
  "order" integer,
  is_public boolean default true
);

-- Feedback submissions from the site (slimmed)
create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  role text not null,
  role_other text,
  tools jsonb
);

-- Helpful indexes
create index if not exists idx_feedback_created_at on public.feedback(created_at desc);

-- Contact requests collected from the Contact Us dialog
create table if not exists public.contact_requests (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  first_name text not null,
  last_name text not null,
  email text not null,
  phone_number text not null,
  job_title text not null,
  company_name text not null,
  message text not null,
  hear_about_us text,
  is_read boolean not null default false
);

create index if not exists idx_contact_requests_created_at on public.contact_requests(created_at desc);

-- Project scores saved per user
create table if not exists public.project_scores (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  scores jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_project_scores_user_name
  on public.project_scores (user_id, name);

-- RBAC: Admin vs Normal Users

-- Store per-user role flags
create table if not exists public.user_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

-- Allow seeding admin emails (treated as admins when they sign in)
create table if not exists public.admin_emails (
  email citext primary key,
  created_at timestamptz not null default now()
);

alter table public.user_roles enable row level security;
alter table public.admin_emails enable row level security;

-- Service role can manage admin_emails; normal clients cannot
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='admin_emails' AND policyname='admin_emails_service_select'
  ) THEN
    CREATE POLICY admin_emails_service_select ON public.admin_emails FOR SELECT TO service_role USING (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='admin_emails' AND policyname='admin_emails_service_modify'
  ) THEN
    CREATE POLICY admin_emails_service_modify ON public.admin_emails FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END$$;

-- Users can read their own user_roles row; modifications require service role
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='user_roles' AND policyname='user_roles_own_select'
  ) THEN
    CREATE POLICY user_roles_own_select ON public.user_roles FOR SELECT USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='user_roles' AND policyname='user_roles_service_modify'
  ) THEN
    CREATE POLICY user_roles_service_modify ON public.user_roles FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END$$;

-- Helper to check if current user is admin (by role or email allowlist)
create or replace function public.is_admin() returns boolean language sql stable as $$
  select exists (
    select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.is_admin = true
  ) or exists (
    select 1 from public.admin_emails ae where ae.email = (auth.jwt() ->> 'email')
  );
$$;

-- Enable RLS and create policies for all tables

-- Categories table policies
alter table public.categories enable row level security;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='categories' AND policyname='categories_select_all'
  ) THEN
    CREATE POLICY categories_select_all ON public.categories FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='categories' AND policyname='categories_admin_all'
  ) THEN
    CREATE POLICY categories_admin_all ON public.categories FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());
  END IF;
END$$;

-- Feedback table policies
alter table public.feedback enable row level security;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='feedback' AND policyname='feedback_insert'
  ) THEN
    CREATE POLICY feedback_insert ON public.feedback FOR INSERT WITH CHECK (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='feedback' AND policyname='feedback_admin_all'
  ) THEN
    CREATE POLICY feedback_admin_all ON public.feedback FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());
  END IF;
END$$;

-- Contact requests table policies
alter table public.contact_requests enable row level security;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='contact_requests' AND policyname='contact_requests_insert'
  ) THEN
    CREATE POLICY contact_requests_insert ON public.contact_requests FOR INSERT WITH CHECK (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='contact_requests' AND policyname='contact_requests_admin_all'
  ) THEN
    CREATE POLICY contact_requests_admin_all ON public.contact_requests FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());
  END IF;
END$$;

-- Project scores table policies
alter table public.project_scores enable row level security;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='project_scores' AND policyname='project_scores_select'
  ) THEN
    CREATE POLICY project_scores_select ON public.project_scores FOR SELECT USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='project_scores' AND policyname='project_scores_insert'
  ) THEN
    CREATE POLICY project_scores_insert ON public.project_scores FOR INSERT WITH CHECK (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='project_scores' AND policyname='project_scores_update'
  ) THEN
    CREATE POLICY project_scores_update ON public.project_scores FOR UPDATE USING (auth.uid() = user_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='project_scores' AND policyname='project_scores_admin_all'
  ) THEN
    CREATE POLICY project_scores_admin_all ON public.project_scores FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());
  END IF;
END$$;




-- Profiles table for user information
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  first_name text,
  last_name text,
  display_name text,
  avatar_url text,
  bio text,
  phone text,
  website text,
  location text,
  company text,
  job_title text
);

-- Create indexes for better performance
create index if not exists idx_profiles_display_name on public.profiles(display_name);
create index if not exists idx_profiles_created_at on public.profiles(created_at desc);

-- Enable RLS
alter table public.profiles enable row level security;

-- Create policies for profiles
DO $$
BEGIN
  -- Users can read their own profile
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='profiles' AND policyname='profiles_own_select'
  ) THEN
    CREATE POLICY profiles_own_select ON public.profiles FOR SELECT USING (auth.uid() = id);
  END IF;
  
  -- Users can update their own profile
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='profiles' AND policyname='profiles_own_update'
  ) THEN
    CREATE POLICY profiles_own_update ON public.profiles FOR UPDATE USING (auth.uid() = id);
  END IF;
  
  -- Users can insert their own profile
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='profiles' AND policyname='profiles_own_insert'
  ) THEN
    CREATE POLICY profiles_own_insert ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);
  END IF;
  
  -- Admins can do everything
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='profiles' AND policyname='profiles_admin_all'
  ) THEN
    CREATE POLICY profiles_admin_all ON public.profiles FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());
  END IF;
END$$;

-- Function to automatically create a profile when a user signs up
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.email)
  );
  return new;
end;
$$ language plpgsql security definer;

-- Trigger to automatically create profile on user signup
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Function to get users with auth information (admin only)
create or replace function public.get_users_with_auth()
returns table (
  id uuid,
  created_at timestamptz,
  updated_at timestamptz,
  first_name text,
  last_name text,
  display_name text,
  avatar_url text,
  bio text,
  phone text,
  website text,
  location text,
  company text,
  job_title text,
  email text,
  auth_created_at timestamptz,
  last_sign_in_at timestamptz,
  email_confirmed_at timestamptz
) 
language sql 
security definer
as $$
  select 
    p.id,
    p.created_at,
    p.updated_at,
    p.first_name,
    p.last_name,
    p.display_name,
    p.avatar_url,
    p.bio,
    p.phone,
    p.website,
    p.location,
    p.company,
    p.job_title,
    au.email,
    au.created_at as auth_created_at,
    au.last_sign_in_at,
    au.email_confirmed_at
  from public.profiles p
  left join auth.users au on p.id = au.id
  where public.is_admin()
  order by p.created_at desc;
$$;
