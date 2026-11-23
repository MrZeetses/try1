import React, { useState } from "react";
import {
  ArrowRight,
  Check,
  ChefHat,
  Eye,
  EyeOff,
  LockKeyhole,
  Mail,
  ShieldCheck,
  Sparkles,
  UserRound,
  UsersRound,
} from "lucide-react";

const STAFF_ROLE_TO_VIEW = {
  cook: "kds",
  waiter: "kds",
  courier: "courier",
  accountant: "erp",
};

export default function AuthScreen({ supabase, onAuthenticated }) {
  const [audience, setAudience] = useState("client");
  const [formMode, setFormMode] = useState("register");
  const [showPassword, setShowPassword] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "", email: "", password: "" });
  const [status, setStatus] = useState({ loading: false, error: "", message: "" });

  const updateField = (field) => (event) => {
    setForm((current) => ({ ...current, [field]: event.target.value }));
    setStatus((current) => ({ ...current, error: "", message: "" }));
  };

  const selectAudience = (nextAudience) => {
    setAudience(nextAudience);
    setFormMode(nextAudience === "staff" ? "login" : "register");
    setStatus({ loading: false, error: "", message: "" });
  };

  const finishSignIn = async (session) => {
    const { data: profile } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", session.user.id)
      .maybeSingle();

    const resolvedProfile = profile || {
      id: session.user.id,
      name: session.user.user_metadata?.name || form.name || "Гость",
      phone: session.user.user_metadata?.phone || form.phone || null,
      role: session.user.user_metadata?.role || "client",
    };

    if (audience === "staff" && resolvedProfile.role === "client") {
      await supabase.auth.signOut();
      throw new Error("Этот аккаунт зарегистрирован как клиент. Выберите вход для клиента.");
    }

    const nextView = audience === "staff"
      ? STAFF_ROLE_TO_VIEW[resolvedProfile.role] || "kds"
      : "guest";

    onAuthenticated({ session, profile: resolvedProfile }, nextView);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setStatus({ loading: true, error: "", message: "" });

    if (!supabase) {
      setStatus({
        loading: false,
        error: "Сервис авторизации временно недоступен. Попробуйте ещё раз немного позже.",
        message: "",
      });
      return;
    }

    try {
      if (audience === "client" && formMode === "register") {
        const { data, error } = await supabase.auth.signUp({
          email: form.email.trim(),
          password: form.password,
          options: {
            data: {
              name: form.name.trim(),
              phone: form.phone.trim(),
              role: "client",
            },
          },
        });

        if (error) throw error;

        if (data.user) {
          const { error: profileError } = await supabase.from("profiles").upsert({
            id: data.user.id,
            name: form.name.trim(),
            phone: form.phone.trim() || null,
            role: "client",
          });
          if (profileError) throw profileError;
        }

        if (data.session) {
          await finishSignIn(data.session);
        } else {
          setStatus({
            loading: false,
            error: "",
            message: "Готово. Подтвердите email по ссылке в письме, затем войдите.",
          });
          setFormMode("login");
        }
        return;
      }

      const { data, error } = await supabase.auth.signInWithPassword({
        email: form.email.trim(),
        password: form.password,
      });
      if (error) throw error;
      await finishSignIn(data.session);
    } catch (error) {
      const commonErrors = {
        "Invalid login credentials": "Неверный email или пароль.",
        "User already registered": "Аккаунт с таким email уже существует.",
        "Password should be at least 6 characters": "Пароль должен содержать минимум 6 символов.",
      };
      setStatus({
        loading: false,
        error: commonErrors[error.message] || error.message || "Не удалось выполнить вход.",
        message: "",
      });
    }
  };

  const handlePasswordReset = async () => {
    if (!form.email.trim()) {
      setStatus({ loading: false, error: "Сначала укажите email.", message: "" });
      return;
    }
    if (!supabase) {
      setStatus({
        loading: false,
        error: "Сервис восстановления пароля временно недоступен.",
        message: "",
      });
      return;
    }

    setStatus({ loading: true, error: "", message: "" });
    const { error } = await supabase.auth.resetPasswordForEmail(form.email.trim());
    setStatus(error
      ? { loading: false, error: error.message, message: "" }
      : {
          loading: false,
          error: "",
          message: "Отправили ссылку для восстановления пароля на ваш email.",
        });
  };

  const isRegistering = audience === "client" && formMode === "register";

  return (
    <main className="min-h-screen bg-[#fffaf7] text-stone-900">
      <div className="grid min-h-screen lg:grid-cols-[1.05fr_0.95fr]">
        <section className="relative hidden overflow-hidden bg-[#ff6900] p-10 text-white lg:flex lg:flex-col lg:justify-between xl:p-14">
          <div className="absolute inset-0 opacity-20 [background-image:radial-gradient(circle_at_25%_20%,white_0,transparent_26%),radial-gradient(circle_at_80%_75%,#6b2500_0,transparent_35%)]" />
          <div className="relative z-10 flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-2xl bg-white text-xl font-black text-[#ff6900] shadow-sm">
              С
            </div>
            <div>
              <p className="text-lg font-black tracking-tight">САМАРКАНД</p>
              <p className="text-xs text-white/75">Восточная кухня каждый день</p>
            </div>
          </div>

          <div className="relative z-10 max-w-xl">
            <div className="mb-7 inline-flex items-center gap-2 rounded-full bg-white/15 px-4 py-2 text-sm font-semibold backdrop-blur">
              <Sparkles className="h-4 w-4" />
              Готовим с теплом, доставляем быстро
            </div>
            <h1 className="text-5xl font-black leading-[1.04] tracking-[-0.04em] xl:text-6xl">
              Любимые блюда стали ещё ближе
            </h1>
            <p className="mt-6 max-w-lg text-lg leading-7 text-white/80">
              Заказывайте плов, манты и блюда с мангала. Копите бонусы и следите за заказом в одном месте.
            </p>

            <div className="mt-9 grid max-w-lg grid-cols-2 gap-3">
              {["Бонусы за каждый заказ", "Быстрое повторение заказа"].map((item) => (
                <div key={item} className="flex items-center gap-2 rounded-2xl bg-white/10 p-3 text-sm font-medium backdrop-blur">
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-white text-[#ff6900]">
                    <Check className="h-3.5 w-3.5" strokeWidth={3} />
                  </span>
                  {item}
                </div>
              ))}
            </div>
          </div>

          <div className="relative z-10 text-xs text-white/65">
            Ежедневно с 10:00 до 23:00 · Доставка от 30 минут
          </div>
        </section>

        <section className="flex items-center justify-center px-5 py-10 sm:px-8 lg:px-12">
          <div className="w-full max-w-[460px]">
            <div className="mb-9 flex items-center gap-3 lg:hidden">
              <div className="grid h-10 w-10 place-items-center rounded-2xl bg-[#ff6900] font-black text-white">С</div>
              <div>
                <p className="font-black tracking-tight">САМАРКАНД</p>
                <p className="text-xs text-stone-500">Восточная кухня</p>
              </div>
            </div>

            <div className="mb-7">
              <p className="mb-2 text-sm font-bold text-[#ff6900]">Добро пожаловать</p>
              <h2 className="text-3xl font-black tracking-[-0.03em] text-stone-950 sm:text-4xl">
                {audience === "client"
                  ? isRegistering ? "Создайте аккаунт" : "Войдите в аккаунт"
                  : "Вход для команды"}
              </h2>
              <p className="mt-3 text-sm leading-6 text-stone-500">
                {audience === "client"
                  ? "Заказы, бонусы и история покупок всегда под рукой."
                  : "Доступ к рабочим разделам определяется вашей ролью."}
              </p>
            </div>

            <div className="mb-6 grid grid-cols-2 rounded-2xl bg-stone-100 p-1.5">
              {[
                { id: "client", label: "Я клиент", icon: UserRound },
                { id: "staff", label: "Я сотрудник", icon: UsersRound },
              ].map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => selectAudience(id)}
                  className={`flex items-center justify-center gap-2 rounded-xl px-3 py-3 text-sm font-bold transition ${
                    audience === id
                      ? "bg-white text-stone-950 shadow-sm"
                      : "text-stone-500 hover:text-stone-800"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </button>
              ))}
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {isRegistering && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="space-y-2 text-sm font-semibold text-stone-700">
                    <span>Имя</span>
                    <input
                      required
                      value={form.name}
                      onChange={updateField("name")}
                      placeholder="Как к вам обращаться"
                      className="auth-input"
                    />
                  </label>
                  <label className="space-y-2 text-sm font-semibold text-stone-700">
                    <span>Телефон</span>
                    <input
                      required
                      type="tel"
                      value={form.phone}
                      onChange={updateField("phone")}
                      placeholder="+7 700 000 00 00"
                      className="auth-input"
                    />
                  </label>
                </div>
              )}

              <label className="block space-y-2 text-sm font-semibold text-stone-700">
                <span>Email</span>
                <span className="relative block">
                  <Mail className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
                  <input
                    required
                    type="email"
                    autoComplete="email"
                    value={form.email}
                    onChange={updateField("email")}
                    placeholder="name@example.com"
                    className="auth-input pl-11"
                  />
                </span>
              </label>

              <label className="block space-y-2 text-sm font-semibold text-stone-700">
                <span className="flex items-center justify-between">
                  <span>Пароль</span>
                  {!isRegistering && audience === "client" && (
                    <button
                      type="button"
                      onClick={handlePasswordReset}
                      className="text-xs font-bold text-[#ff6900] hover:text-[#e85f00]"
                    >
                      Забыли пароль?
                    </button>
                  )}
                </span>
                <span className="relative block">
                  <LockKeyhole className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
                  <input
                    required
                    minLength={6}
                    type={showPassword ? "text" : "password"}
                    autoComplete={isRegistering ? "new-password" : "current-password"}
                    value={form.password}
                    onChange={updateField("password")}
                    placeholder={isRegistering ? "Минимум 6 символов" : "Введите пароль"}
                    className="auth-input px-11"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((visible) => !visible)}
                    aria-label={showPassword ? "Скрыть пароль" : "Показать пароль"}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-stone-400 transition hover:text-stone-700"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </span>
              </label>

              {status.error && (
                <div role="alert" className="rounded-2xl bg-red-50 px-4 py-3 text-sm leading-5 text-red-700">
                  {status.error}
                </div>
              )}
              {status.message && (
                <div className="rounded-2xl bg-emerald-50 px-4 py-3 text-sm leading-5 text-emerald-700">
                  {status.message}
                </div>
              )}

              <button
                type="submit"
                disabled={status.loading}
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[#ff6900] px-5 py-3.5 text-sm font-black text-white shadow-[0_8px_24px_rgba(255,105,0,0.22)] transition hover:bg-[#ef6200] disabled:cursor-wait disabled:opacity-60"
              >
                {status.loading
                  ? "Подождите..."
                  : isRegistering ? "Создать аккаунт" : audience === "staff" ? "Открыть рабочее место" : "Войти"}
                {!status.loading && <ArrowRight className="h-4 w-4" />}
              </button>
            </form>

            {audience === "client" && (
              <p className="mt-6 text-center text-sm text-stone-500">
                {isRegistering ? "Уже есть аккаунт?" : "Впервые у нас?"}{" "}
                <button
                  type="button"
                  onClick={() => {
                    setFormMode(isRegistering ? "login" : "register");
                    setStatus({ loading: false, error: "", message: "" });
                  }}
                  className="font-black text-[#ff6900] hover:text-[#e85f00]"
                >
                  {isRegistering ? "Войти" : "Зарегистрироваться"}
                </button>
              </p>
            )}

            <div className="mt-8 flex items-center justify-center gap-2 text-xs text-stone-400">
              {audience === "staff" ? <ShieldCheck className="h-4 w-4" /> : <ChefHat className="h-4 w-4" />}
              {audience === "staff"
                ? "Защищённый доступ только для сотрудников"
                : "Продолжая, вы соглашаетесь с условиями сервиса"}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
