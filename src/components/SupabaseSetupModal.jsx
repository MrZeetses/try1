import React, { useState } from 'react';
import { Database, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { saveSupabaseConfig, resetSupabaseClient, testSupabaseConnection } from '../lib/supabase';

export default function SupabaseSetupModal({ onConnected }) {
  const [url, setUrl] = useState('');
  const [anonKey, setAnonKey] = useState('');
  const [status, setStatus] = useState({ loading: false, error: '', success: false });

  const handleTestAndSave = async (e) => {
    e.preventDefault();
    setStatus({ loading: true, error: '', success: false });
    const res = await testSupabaseConnection(url, anonKey);
    if (res.ok) {
      saveSupabaseConfig(url, anonKey);
      resetSupabaseClient();
      setStatus({ loading: false, error: '', success: true });
      setTimeout(() => onConnected(), 500);
    } else {
      setStatus({
        loading: false,
        error: `Ошибка подключения: ${res.error}. Убедитесь, что выполнен supabase/schema.sql.`,
        success: false,
      });
    }
  };

  return (
    <div className="min-h-screen bg-stone-950 text-stone-100 flex items-center justify-center p-4">
      <div className="max-w-xl w-full bg-stone-900 border border-amber-500/30 rounded-2xl p-6 shadow-2xl">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-3 bg-amber-500/10 rounded-xl text-amber-400">
            <Database className="w-7 h-7" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-amber-400">Подключение к Supabase</h1>
            <p className="text-sm text-stone-400">Ресторан восточной кухни «Самарканд» • 100% Cloud ERP</p>
          </div>
        </div>

        <div className="bg-stone-950/70 border border-stone-800 rounded-xl p-4 mb-5 text-xs text-stone-300 space-y-1.5">
          <p className="font-semibold text-amber-300">Инструкция по запуску:</p>
          <p>1. Создайте проект на <span className="text-white">supabase.com</span>.</p>
          <p>2. Откройте <b>SQL Editor</b> и выполните файл <code>supabase/schema.sql</code>.</p>
          <p>3. Перейдите в <b>Project Settings → API</b> и скопируйте Project URL и anon public key ниже.</p>
        </div>

        <form onSubmit={handleTestAndSave} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-stone-400 mb-1">SUPABASE_URL</label>
            <input
              type="url"
              required
              placeholder="https://xxxxxxxxxxxx.supabase.co"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="w-full bg-stone-950 border border-stone-700 rounded-lg px-3 py-2.5 text-sm focus:border-amber-500 outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-stone-400 mb-1">SUPABASE_ANON_KEY</label>
            <input
              type="password"
              required
              placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
              value={anonKey}
              onChange={(e) => setAnonKey(e.target.value)}
              className="w-full bg-stone-950 border border-stone-700 rounded-lg px-3 py-2.5 text-sm focus:border-amber-500 outline-none"
            />
          </div>

          {status.error && (
            <div className="flex items-start gap-2 text-red-400 bg-red-950/40 border border-red-800/50 p-3 rounded-lg text-xs">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{status.error}</span>
            </div>
          )}

          {status.success && (
            <div className="flex items-center gap-2 text-emerald-400 bg-emerald-950/40 border border-emerald-800/50 p-3 rounded-lg text-xs">
              <CheckCircle2 className="w-4 h-4" />
              <span>Соединение установлено! Загрузка платформы...</span>
            </div>
          )}

          <button
            type="submit"
            disabled={status.loading}
            className="w-full bg-amber-600 hover:bg-amber-500 text-stone-950 font-semibold py-2.5 rounded-lg flex items-center justify-center gap-2 transition"
          >
            {status.loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Проверить соединение и войти'}
          </button>
        </form>
      </div>
    </div>
  );
}
