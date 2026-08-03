import { createClient } from '@supabase/supabase-js';

const supabase = process.env.SUPABASE_URL
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
  : null;

export async function saveResult(result) {
  if (!supabase) throw new Error('Supabase not configured');
  const { data, error } = await supabase.from('results').insert(result).select().single();
  if (error) throw error;
  return data;
}
