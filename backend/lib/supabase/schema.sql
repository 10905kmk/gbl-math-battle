-- Supabase SQL Editor에서 실행. 실제 프로젝트 생성/URL·키 발급은 사용자가 브라우저에서 직접 진행.
create table results (
  id uuid primary key default gen_random_uuid(),
  weapon_name text,
  weapon_image text,       -- Konva 캔버스 toDataURL() 결과, base64 그대로 저장 (Storage 버킷 미사용)
  weapon_stats jsonb,      -- { attack, defense }
  weapon_damage integer,
  win boolean,
  created_at timestamptz not null default now()
);
