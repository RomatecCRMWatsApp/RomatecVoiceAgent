// Cliente Supabase compartilhado pra rag*.ts — v1.26.0
// Usa SERVICE_KEY (acesso total, server-side only — NUNCA expor ao client).

import { createClient, SupabaseClient } from '@supabase/supabase-js';

let _client: SupabaseClient | null = null;

export function supabase(): SupabaseClient {
  if (!_client) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_KEY;
    if (!url || !key) {
      throw new Error(
        'Supabase não configurado: defina SUPABASE_URL e SUPABASE_SERVICE_KEY no .env'
      );
    }
    _client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return _client;
}

export function supabaseConfigurado(): boolean {
  return !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY);
}
