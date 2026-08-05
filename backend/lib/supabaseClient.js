import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

const supabase = process.env.SUPABASE_URL
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
  : null;

// SUPABASE_URL 미설정 시 실제 저장 대신 mock 결과를 반환 — 로컬 개발/통합 테스트/데모가
// 실제 Supabase 키 없이도 막히지 않게 하기 위함 (weapon-crafting의 aiClient.js MOCK_AI와 같은 이유).
export async function saveResult(result) {
  if (!supabase) {
    console.warn('[supabaseClient] SUPABASE_URL 미설정 — mock 저장으로 대체');
    return { id: randomUUID(), ...result, created_at: new Date().toISOString() };
  }
  const { data, error } = await supabase.from('results').insert(result).select().single();
  if (error) throw error;
  return data;
}
