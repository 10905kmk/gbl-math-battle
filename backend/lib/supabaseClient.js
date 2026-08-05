import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

// URL/키 둘 중 하나만 설정된 상태로 createClient()를 호출하면 모듈 로드 시점에
// "supabaseKey is required" 등으로 즉시 throw해서 서버 전체가 못 뜬다 — 부스 당일
// .env에 URL만 붙여넣고 키를 깜빡하는 실수 하나로 결과 저장뿐 아니라 서버 전체가
// 죽는 걸 막기 위해 둘 다 있어야만 실제 클라이언트를 만든다.
const supabase = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
  : null;

// SUPABASE_URL/SUPABASE_SERVICE_KEY 미설정 시 실제 저장 대신 mock 결과를 반환 — 로컬 개발/통합
// 테스트/데모가 실제 Supabase 키 없이도 막히지 않게 하기 위함 (weapon-crafting의 aiClient.js
// MOCK_AI와 같은 이유).
export async function saveResult(result) {
  if (!supabase) {
    console.warn('[supabaseClient] SUPABASE_URL/SUPABASE_SERVICE_KEY 미설정 — mock 저장으로 대체');
    return { id: randomUUID(), ...result, created_at: new Date().toISOString() };
  }
  const { data, error } = await supabase.from('results').insert(result).select().single();
  if (error) throw error;
  return data;
}
