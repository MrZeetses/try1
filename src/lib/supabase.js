import { createClient } from '@supabase/supabase-js';

const STORAGE_URL_KEY = 'samarkand_supabase_url';
const STORAGE_ANON_KEY = 'samarkand_supabase_anon_key';

export function getSupabaseConfig() {
  const url = import.meta.env.VITE_SUPABASE_URL || localStorage.getItem(STORAGE_URL_KEY) || '';
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || localStorage.getItem(STORAGE_ANON_KEY) || '';
  return { url: url.trim(), anonKey: anonKey.trim() };
}

export function saveSupabaseConfig(url, anonKey) {
  localStorage.setItem(STORAGE_URL_KEY, url.trim());
  localStorage.setItem(STORAGE_ANON_KEY, anonKey.trim());
}

export function clearSupabaseConfig() {
  localStorage.removeItem(STORAGE_URL_KEY);
  localStorage.removeItem(STORAGE_ANON_KEY);
}

let clientInstance = null;

export function getSupabase() {
  const { url, anonKey } = getSupabaseConfig();
  if (!url || !anonKey) return null;
  if (!clientInstance) {
    clientInstance = createClient(url, anonKey);
  }
  return clientInstance;
}

export function resetSupabaseClient() {
  clientInstance = null;
}

export async function testSupabaseConnection(url, anonKey) {
  try {
    const tempClient = createClient(url.trim(), anonKey.trim());
    const { error } = await tempClient.from('menu_items').select('id').limit(1);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
