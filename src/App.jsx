import React, { useState } from 'react';
import { UtensilsCrossed, ChefHat, Truck, BarChart3, LogOut } from 'lucide-react';
import { getSupabase, clearSupabaseConfig, resetSupabaseClient } from './lib/supabase';
import SupabaseSetupModal from './components/SupabaseSetupModal';
import GuestView from './components/GuestView';
import StaffKDSView from './components/StaffKDSView';
import AccountantERPView from './components/AccountantERPView';

export default function App() {
  const [connected, setConnected] = useState(Boolean(getSupabase()));
  const [role, setRole] = useState('guest');

  if (!connected) {
    return <SupabaseSetupModal onConnected={() => setConnected(true)} />;
  }

  const handleDisconnect = () => {
    clearSupabaseConfig();
    resetSupabaseClient();
    setConnected(false);
  };

  return (
    <div className="min-h-screen bg-stone-950 text-stone-100 font-sans">
      <header className="sticky top-0 z-40 bg-stone-950/90 backdrop-blur border-b border-stone-800">
        <div className="max-w-7xl mx-auto px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-amber-500 flex items-center justify-center text-stone-950 font-black">С</div>
            <div>
              <h1 className="font-bold text-base leading-tight text-amber-400">САМАРКАНД</h1>
              <p className="text-[11px] text-stone-400">Cloud Restaurant Platform • Supabase Realtime</p>
            </div>
          </div>

          <nav className="flex flex-wrap gap-1.5">
            {[
              { id: 'guest', label: 'Гость', icon: UtensilsCrossed },
              { id: 'kds', label: 'Кухня / Зал', icon: ChefHat },
              { id: 'courier', label: 'Курьер', icon: Truck },
              { id: 'erp', label: 'Бухгалтер ERP', icon: BarChart3 }
            ].map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setRole(id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition ${
                  role === id ? 'bg-amber-500 text-stone-950' : 'bg-stone-900 text-stone-300 hover:bg-stone-800'
                }`}
              >
                <Icon className="w-3.5 h-3.5" /> {label}
              </button>
            ))}
            <button onClick={handleDisconnect} title="Сменить ключи Supabase" className="p-1.5 bg-stone-900 hover:bg-red-950 text-stone-400 hover:text-red-400 rounded-lg">
              <LogOut className="w-4 h-4" />
            </button>
          </nav>
        </div>
      </header>

      <main>
        {role === 'guest' && <GuestView />}
        {role === 'kds' && <StaffKDSView mode="kds" />}
        {role === 'courier' && <StaffKDSView mode="courier" />}
        {role === 'erp' && <AccountantERPView />}
      </main>
    </div>
  );
}
