import React, { useEffect, useMemo, useState } from "react";
import { BarChart3, ChefHat, LogOut, Truck, UtensilsCrossed } from "lucide-react";
import { getSupabase } from "./lib/supabase";
import AccountantERPView from "./components/AccountantERPView";
import AuthScreen from "./components/AuthScreen";
import GuestView from "./components/GuestView";
import StaffKDSView from "./components/StaffKDSView";

const ROLE_TO_VIEW = {
  client: "guest",
  cook: "kds",
  waiter: "kds",
  courier: "courier",
  accountant: "erp",
};

const VIEW_META = {
  guest: { label: "Меню", icon: UtensilsCrossed },
  kds: { label: "Кухня и зал", icon: ChefHat },
  courier: { label: "Доставка", icon: Truck },
  erp: { label: "Управление", icon: BarChart3 },
};

export default function App() {
  const supabase = useMemo(() => getSupabase(), []);
  const [account, setAccount] = useState(null);
  const [role, setRole] = useState("guest");
  const [checkingSession, setCheckingSession] = useState(Boolean(supabase));

  useEffect(() => {
    if (!supabase) return;
    let active = true;

    const restoreSession = async () => {
      const { data } = await supabase.auth.getSession();
      const session = data.session;
      if (!active) return;

      if (session) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("*")
          .eq("id", session.user.id)
          .maybeSingle();
        const resolvedProfile = profile || {
          id: session.user.id,
          name: session.user.user_metadata?.name || "Гость",
          role: session.user.user_metadata?.role || "client",
        };
        setAccount({ session, profile: resolvedProfile });
        setRole(ROLE_TO_VIEW[resolvedProfile.role] || "guest");
      }
      setCheckingSession(false);
    };

    restoreSession();
    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") setAccount(null);
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, [supabase]);

  const handleAuthenticated = (nextAccount, nextRole) => {
    setAccount(nextAccount);
    setRole(nextRole);
  };

  const handleSignOut = async () => {
    if (supabase) await supabase.auth.signOut();
    setAccount(null);
    setRole("guest");
  };

  if (checkingSession) {
    return (
      <div className="grid min-h-screen place-items-center bg-[#fffaf7]">
        <div className="flex items-center gap-3 text-sm font-bold text-stone-500">
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-stone-200 border-t-[#ff6900]" />
          Загружаем Самарканд
        </div>
      </div>
    );
  }

  if (!account) {
    return <AuthScreen supabase={supabase} onAuthenticated={handleAuthenticated} />;
  }

  const availableViews = account.profile.role === "client"
    ? ["guest"]
    : [ROLE_TO_VIEW[account.profile.role] || "kds"];

  return (
    <div className="min-h-screen bg-[#f7f7f7] text-stone-900 font-sans">
      <header className="sticky top-0 z-40 border-b border-stone-200 bg-white/90 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-[#ff6900] flex items-center justify-center text-white font-black shadow-sm">С</div>
            <div>
              <h1 className="font-black text-base leading-tight text-stone-950 tracking-tight">САМАРКАНД</h1>
              <p className="text-[11px] text-stone-500">
                {account.profile.name || "Личный кабинет"}
              </p>
            </div>
          </div>

          <nav className="flex items-center gap-2">
            {availableViews.map((id) => {
              const { label, icon: Icon } = VIEW_META[id];
              return (
              <button
                key={id}
                onClick={() => setRole(id)}
                className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition ${
                  role === id ? "bg-[#fff0e6] text-[#e85f00]" : "text-stone-500 hover:bg-stone-100"
                }`}
              >
                <Icon className="w-3.5 h-3.5" /> {label}
              </button>
              );
            })}
            <button
              onClick={handleSignOut}
              title="Выйти"
              aria-label="Выйти из аккаунта"
              className="p-2 text-stone-400 hover:bg-red-50 hover:text-red-500 rounded-xl transition"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </nav>
        </div>
      </header>

      <main>
        {role === "guest" && <GuestView userId={account.profile.id} />}
        {role === "kds" && <StaffKDSView mode="kds" />}
        {role === "courier" && <StaffKDSView mode="courier" />}
        {role === "erp" && <AccountantERPView />}
      </main>
    </div>
  );
}
