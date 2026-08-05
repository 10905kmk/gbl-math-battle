-- Supabase SQL Editor에서 실행. 실제 프로젝트 생성/URL·키 발급은 사용자가 브라우저에서 직접 진행.
create table if not exists results (
  id uuid primary key default gen_random_uuid(),
  weapon_name text,
  weapon_image text,       -- Konva 캔버스 toDataURL() 결과, base64 그대로 저장 (Storage 버킷 미사용)
  weapon_stats jsonb,      -- { attack, defense }
  weapon_damage integer,
  win boolean,
  created_at timestamptz not null default now()
);

-- 기본적으로 RLS를 꺼둔 테이블은 anon 키로 select/insert/delete가 전부 가능하다. 다음 스펙에서
-- 만들 result-page(Vercel)가 anon 키를 브라우저에 그대로 노출할 예정이므로, 지금 스키마를
-- 만드는 시점에 미리 잠가둔다 — 나중에 실 데이터가 쌓인 뒤에 마이그레이션하는 것보다 훨씬 싸다.
-- 쓰기(insert)는 서버가 service key로만 하므로(RLS 우회) 별도 insert 정책은 필요 없다.
alter table results enable row level security;
create policy "public read" on results for select using (true);
