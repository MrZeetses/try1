import React, { useEffect, useState } from 'react';
import {
  ShoppingBag, Bell, Receipt, Star, Flame, Utensils,
  Truck, Store, Calendar, X, Sparkles, Gift
} from 'lucide-react';
import { getSupabase } from '../lib/supabase';

const GUEST_ID = '11111111-1111-1111-1111-111111111111';

export default function GuestView() {
  const supabase = getSupabase();
  const [tab, setTab] = useState('menu');
  const [menu, setMenu] = useState([]);
  const [category, setCategory] = useState('Все');
  const [profile, setProfile] = useState(null);
  const [orders, setOrders] = useState([]);
  const [cart, setCart] = useState([]);
  const [selectedDish, setSelectedDish] = useState(null);
  const [selectedMods, setSelectedMods] = useState([]);

  const params = new URLSearchParams(window.location.search);
  const urlTable = params.get('table');
  const [orderType, setOrderType] = useState('table');
  const [tableNumber, setTableNumber] = useState(urlTable ? Number(urlTable) : 5);
  const [address, setAddress] = useState('');
  const [comment, setComment] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('card_pos');
  const [promoInput, setPromoInput] = useState('');
  const [appliedPromo, setAppliedPromo] = useState(null);
  const [bonusToUse, setBonusToUse] = useState(0);
  const [toast, setToast] = useState('');

  const [booking, setBooking] = useState({
    guest_name: '', phone: '', zone: 'main_hall', table_number: 3, guests_count: 4, reserved_for: '', deposit_amount: 5000
  });

  const notify = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3500);
  };

  const fetchAll = async () => {
    const [{ data: m }, { data: p }, { data: o }] = await Promise.all([
      supabase.from('menu_items').select('*').order('category'),
      supabase.from('profiles').select('*').eq('id', GUEST_ID).single(),
      supabase.from('orders').select('*, order_items(*)').eq('user_id', GUEST_ID).order('created_at', { ascending: false })
    ]);
    if (m) setMenu(m);
    if (p) setProfile(p);
    if (o) setOrders(o);
  };

  useEffect(() => {
    fetchAll();
    const channel = supabase
      .channel('guest-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'menu_items' }, fetchAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, fetchAll)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, []);

  const sendServiceRequest = async (type) => {
    const { error } = await supabase.from('service_requests').insert({
      table_number: tableNumber,
      request_type: type,
      status: 'pending'
    });
    if (!error) {
      notify(type === 'call_waiter' ? `Официант вызван к столу №${tableNumber}` : `Счет и терминал запрошены к столу №${tableNumber}`);
    }
  };

  const addToCart = (item, mods = []) => {
    setCart((prev) => {
      const key = item.id + JSON.stringify(mods);
      const exists = prev.find((i) => i.key === key);
      if (exists) return prev.map((i) => (i.key === key ? { ...i, quantity: i.quantity + 1 } : i));
      return [...prev, { key, menu_item_id: item.id, title: item.title, price: Number(item.price), quantity: 1, selected_modifiers: mods }];
    });
    setSelectedDish(null);
    setSelectedMods([]);
  };

  const checkPromo = async () => {
    const { data } = await supabase.from('promocodes').select('*').eq('code', promoInput.trim().toUpperCase()).eq('is_active', true).single();
    if (!data) return notify('Промокод не найден или неактивен');
    setAppliedPromo(data);
    notify(`Промокод ${data.code} применен!`);
  };

  const subtotal = cart.reduce((s, i) => s + i.price * i.quantity, 0);
  const pickupDiscount = orderType === 'pickup' ? Math.round(subtotal * 0.05) : 0;
  const promoDiscount = appliedPromo
    ? appliedPromo.discount_type === 'percent'
      ? Math.round(subtotal * (appliedPromo.discount_value / 100))
      : Number(appliedPromo.discount_value)
    : 0;
  const totalDiscount = pickupDiscount + promoDiscount;
  const afterDiscount = Math.max(0, subtotal - totalDiscount);
  const maxBonusAllowed = Math.min(Number(profile?.bonus_balance || 0), Math.floor(afterDiscount * 0.3));
  const safeBonusUsed = Math.min(bonusToUse, maxBonusAllowed);
  const deliveryFee = orderType === 'delivery' ? (afterDiscount >= 10000 ? 0 : 1200) : 0;
  const finalTotal = Math.max(0, afterDiscount - safeBonusUsed + deliveryFee);

  const placeOrder = async () => {
    if (cart.length === 0) return;
    if (orderType === 'delivery' && !address.trim()) return notify('Укажите адрес доставки');

    const isAddon = orderType === 'table' && orders.some(
      (o) => o.table_number === tableNumber && ['new', 'cooking', 'ready'].includes(o.status)
    );

    const { error } = await supabase.rpc('create_full_order', {
      p_user_id: GUEST_ID,
      p_order_type: orderType,
      p_table_number: orderType === 'table' ? tableNumber : null,
      p_is_addon_order: isAddon,
      p_delivery_address: orderType === 'delivery' ? address : null,
      p_comment: comment,
      p_payment_method: paymentMethod,
      p_discount_amount: totalDiscount,
      p_bonus_used: safeBonusUsed,
      p_delivery_fee: deliveryFee,
      p_items: cart.map(({ menu_item_id, quantity, selected_modifiers }) => ({
        menu_item_id, quantity, selected_modifiers
      }))
    });

    if (error) return notify(`Ошибка: ${error.message}`);
    setCart([]);
    setAppliedPromo(null);
    setBonusToUse(0);
    setComment('');
    notify(isAddon ? 'Дозаказ отправлен на кухню!' : 'Заказ успешно оформлен!');
    setTab('profile');
    fetchAll();
  };

  const submitReview = async (orderId, rating, reviewText, tips) => {
    await supabase.from('reviews').insert({
      order_id: orderId,
      rating,
      comment: reviewText,
      is_public: rating >= 4,
      manager_resolved: rating >= 4
    });
    if (tips > 0) {
      await supabase.from('orders').update({ tips_amount: tips }).eq('id', orderId);
    }
    if (rating >= 4 && profile) {
      await supabase.from('profiles').update({ bonus_balance: Number(profile.bonus_balance) + 100 }).eq('id', GUEST_ID);
      notify('Спасибо за высокую оценку! Вам начислено +100 бонусов.');
    } else {
      notify('Спасибо за обратную связь. Менеджер уже получил уведомление.');
    }
    fetchAll();
  };

  const submitBooking = async (e) => {
    e.preventDefault();
    const { error } = await supabase.from('reservations').insert({
      ...booking,
      status: 'confirmed'
    });
    if (!error && Number(booking.deposit_amount) > 0) {
      await supabase.from('accounting_transactions').insert({
        type: 'income',
        category: 'Депозит за бронь',
        amount: Number(booking.deposit_amount),
        payment_source: 'bank_account',
        description: `Депозит: ${booking.guest_name} (Стол №${booking.table_number}, ${booking.zone})`
      });
    }
    if (!error) notify('Столик успешно забронирован! Депозит учтен.');
  };

  const categories = ['Все', ...new Set(menu.map((m) => m.category))];
  const filteredMenu = category === 'Все' ? menu : menu.filter((m) => m.category === category);

  return (
    <div className="max-w-7xl mx-auto p-4 pb-20">
      {toast && (
        <div className="fixed bottom-5 right-5 z-50 bg-amber-500 text-stone-950 font-semibold px-4 py-3 rounded-xl shadow-xl">
          {toast}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 mb-6 bg-stone-900/80 border border-stone-800 p-3 rounded-2xl">
        <div className="flex gap-2">
          {[
            { id: 'menu', label: 'Меню', icon: Utensils },
            { id: 'profile', label: `Профиль (${profile?.bonus_balance || 0} Б)`, icon: Gift },
            { id: 'booking', label: 'Бронь столов', icon: Calendar }
          ].map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`px-4 py-2 rounded-xl text-sm font-medium flex items-center gap-2 transition ${
                tab === id ? 'bg-amber-500 text-stone-950' : 'bg-stone-800 text-stone-300 hover:bg-stone-700'
              }`}
            >
              <Icon className="w-4 h-4" /> {label}
            </button>
          ))}
        </div>

        {orderType === 'table' && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-amber-400 font-semibold px-2">Стол №{tableNumber}</span>
            <button onClick={() => sendServiceRequest('call_waiter')} className="px-3 py-1.5 bg-stone-800 hover:bg-stone-700 rounded-lg text-xs flex items-center gap-1.5 text-stone-200">
              <Bell className="w-3.5 h-3.5 text-amber-400" /> Позвать официанта
            </button>
            <button onClick={() => sendServiceRequest('request_bill')} className="px-3 py-1.5 bg-stone-800 hover:bg-stone-700 rounded-lg text-xs flex items-center gap-1.5 text-stone-200">
              <Receipt className="w-3.5 h-3.5 text-emerald-400" /> Счет / Терминал
            </button>
          </div>
        )}
      </div>

      {tab === 'menu' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-4">
            <div className="grid grid-cols-3 gap-2 bg-stone-900 p-2 rounded-xl border border-stone-800">
              {[
                { id: 'table', label: 'В зале', icon: Utensils },
                { id: 'delivery', label: 'Доставка', icon: Truck },
                { id: 'pickup', label: 'Самовывоз (-5%)', icon: Store }
              ].map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  onClick={() => setOrderType(id)}
                  className={`py-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 ${
                    orderType === id ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40' : 'text-stone-400'
                  }`}
                >
                  <Icon className="w-4 h-4" /> {label}
                </button>
              ))}
            </div>

            {orderType === 'table' && (
              <div className="flex items-center gap-3 text-sm bg-stone-900/50 p-3 rounded-xl border border-stone-800">
                <span className="text-stone-400">Номер столика (1–20):</span>
                <input
                  type="number" min="1" max="20" value={tableNumber}
                  onChange={(e) => setTableNumber(Number(e.target.value))}
                  className="w-20 bg-stone-950 border border-stone-700 rounded-lg px-2 py-1 text-center"
                />
              </div>
            )}

            <div className="flex gap-2 overflow-x-auto pb-1">
              {categories.map((c) => (
                <button
                  key={c}
                  onClick={() => setCategory(c)}
                  className={`px-3.5 py-1.5 rounded-full text-xs font-medium whitespace-nowrap ${
                    category === c ? 'bg-amber-500 text-stone-950' : 'bg-stone-900 text-stone-300 border border-stone-800'
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {filteredMenu.map((item) => (
                <div key={item.id} className={`bg-stone-900 border rounded-2xl overflow-hidden flex flex-col ${!item.in_stock ? 'opacity-50 border-red-900/50' : 'border-stone-800'}`}>
                  <img src={item.image_url} alt={item.title} className="h-40 w-full object-cover" />
                  <div className="p-4 flex-1 flex flex-col justify-between">
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="font-bold text-stone-100">{item.title}</h3>
                        <span className="text-xs text-stone-400">{item.weight}</span>
                      </div>
                      <p className="text-xs text-stone-400 mt-1 line-clamp-2">{item.description}</p>
                      <div className="flex gap-2 mt-2">
                        {item.is_popular && <span className="text-[10px] bg-amber-500/20 text-amber-400 px-2 py-0.5 rounded-full">Хит</span>}
                        {item.is_spicy && <span className="text-[10px] bg-red-500/20 text-red-400 px-2 py-0.5 rounded-full flex items-center gap-0.5"><Flame className="w-3 h-3" /> Острое</span>}
                      </div>
                    </div>
                    <div className="flex items-center justify-between mt-4 pt-3 border-t border-stone-800">
                      <span className="font-bold text-amber-400">{Number(item.price).toLocaleString()} ₸</span>
                      {item.in_stock ? (
                        <button
                          onClick={() => (item.modifiers?.length ? setSelectedDish(item) : addToCart(item))}
                          className="px-3.5 py-1.5 bg-amber-500 hover:bg-amber-400 text-stone-950 font-semibold text-xs rounded-lg"
                        >
                          + В заказ
                        </button>
                      ) : (
                        <span className="text-xs font-semibold text-red-400 bg-red-950/60 px-2.5 py-1 rounded-lg">Стоп-лист</span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-stone-900 border border-stone-800 rounded-2xl p-5 h-fit sticky top-4 space-y-4">
            <h2 className="font-bold text-lg flex items-center gap-2"><ShoppingBag className="w-5 h-5 text-amber-400" /> Ваш заказ</h2>
            {cart.length === 0 ? (
              <p className="text-sm text-stone-500 py-8 text-center">Корзина пуста. Выберите блюда из меню.</p>
            ) : (
              <>
                <div className="space-y-3 max-h-60 overflow-y-auto pr-1">
                  {cart.map((item) => (
                    <div key={item.key} className="flex justify-between items-start text-sm border-b border-stone-800 pb-2">
                      <div>
                        <p className="font-medium">{item.title}</p>
                        {item.selected_modifiers?.length > 0 && (
                          <p className="text-[11px] text-amber-400/80">{item.selected_modifiers.join(', ')}</p>
                        )}
                        <p className="text-xs text-stone-400">{item.quantity} × {item.price} ₸</p>
                      </div>
                      <button onClick={() => setCart(cart.filter((c) => c.key !== item.key))} className="text-stone-500 hover:text-red-400">
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>

                {orderType === 'delivery' && (
                  <input
                    type="text" placeholder="Адрес доставки (улица, дом, кв)"
                    value={address} onChange={(e) => setAddress(e.target.value)}
                    className="w-full bg-stone-950 border border-stone-700 rounded-lg px-3 py-2 text-xs"
                  />
                )}

                <input
                  type="text" placeholder="Комментарий кухне..."
                  value={comment} onChange={(e) => setComment(e.target.value)}
                  className="w-full bg-stone-950 border border-stone-700 rounded-lg px-3 py-2 text-xs"
                />

                <div className="flex gap-2">
                  <input
                    type="text" placeholder="Промокод (PLOV10)"
                    value={promoInput} onChange={(e) => setPromoInput(e.target.value)}
                    className="flex-1 bg-stone-950 border border-stone-700 rounded-lg px-3 py-1.5 text-xs uppercase"
                  />
                  <button onClick={checkPromo} className="px-3 py-1.5 bg-stone-800 hover:bg-stone-700 rounded-lg text-xs">Применить</button>
                </div>

                {maxBonusAllowed > 0 && (
                  <div className="bg-stone-950 p-3 rounded-xl border border-stone-800 text-xs space-y-1.5">
                    <div className="flex justify-between">
                      <span className="text-stone-400">Списать бонусы (макс. {maxBonusAllowed} ₸):</span>
                      <span className="text-amber-400 font-bold">{safeBonusUsed} ₸</span>
                    </div>
                    <input
                      type="range" min="0" max={maxBonusAllowed} step="50"
                      value={safeBonusUsed} onChange={(e) => setBonusToUse(Number(e.target.value))}
                      className="w-full accent-amber-500"
                    />
                  </div>
                )}

                <select
                  value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}
                  className="w-full bg-stone-950 border border-stone-700 rounded-lg px-3 py-2 text-xs"
                >
                  <option value="card_pos">Картой (POS-терминал)</option>
                  <option value="online">Онлайн-оплата</option>
                  <option value="cash">Наличными</option>
                </select>

                <div className="text-xs space-y-1 pt-2 border-t border-stone-800">
                  <div className="flex justify-between text-stone-400"><span>Сумма:</span><span>{subtotal.toLocaleString()} ₸</span></div>
                  {totalDiscount > 0 && <div className="flex justify-between text-emerald-400"><span>Скидка:</span><span>-{totalDiscount.toLocaleString()} ₸</span></div>}
                  {safeBonusUsed > 0 && <div className="flex justify-between text-amber-400"><span>Бонусы:</span><span>-{safeBonusUsed.toLocaleString()} ₸</span></div>}
                  {deliveryFee > 0 && <div className="flex justify-between text-stone-400"><span>Доставка:</span><span>{deliveryFee.toLocaleString()} ₸</span></div>}
                  <div className="flex justify-between text-base font-bold text-white pt-1"><span>Итого:</span><span>{finalTotal.toLocaleString()} ₸</span></div>
                </div>

                <button onClick={placeOrder} className="w-full py-3 bg-amber-500 hover:bg-amber-400 text-stone-950 font-bold rounded-xl transition">
                  Оформить заказ
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {tab === 'profile' && profile && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-stone-900 border border-stone-800 p-5 rounded-2xl">
              <p className="text-xs text-stone-400">Активные бонусы</p>
              <p className="text-3xl font-bold text-amber-400 mt-1">{Number(profile.bonus_balance).toLocaleString()} ₸</p>
              <p className="text-xs text-stone-500 mt-1">Ожидают начисления: +{Number(profile.pending_bonus).toLocaleString()} ₸</p>
            </div>
            <div className="bg-stone-900 border border-stone-800 p-5 rounded-2xl">
              <p className="text-xs text-stone-400">Уровень лояльности</p>
              <p className="text-2xl font-bold uppercase text-white mt-1 flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-amber-400" /> {profile.loyalty_tier}
              </p>
              <p className="text-xs text-stone-400 mt-1">
                {profile.loyalty_tier === 'gold' ? 'Кэшбэк 7% (макс. уровень)' : profile.loyalty_tier === 'silver' ? 'Кэшбэк 4% (до Золота 50 000 ₸)' : 'Кэшбэк 1% (до Серебра 15 000 ₸)'}
              </p>
            </div>
            <div className="bg-stone-900 border border-stone-800 p-5 rounded-2xl">
              <p className="text-xs text-stone-400">Всего потрачено</p>
              <p className="text-3xl font-bold text-emerald-400 mt-1">{Number(profile.total_spent).toLocaleString()} ₸</p>
            </div>
          </div>

          <h3 className="font-bold text-lg">История заказов (Realtime)</h3>
          <div className="space-y-3">
            {orders.map((o) => (
              <div key={o.id} className="bg-stone-900 border border-stone-800 p-4 rounded-2xl space-y-2">
                <div className="flex flex-wrap justify-between items-center gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-amber-400">Заказ #{o.id}</span>
                    <span className="text-xs px-2.5 py-0.5 rounded-full bg-stone-800 uppercase">{o.status}</span>
                    {o.is_addon_order && <span className="text-[10px] bg-blue-500/20 text-blue-300 px-2 py-0.5 rounded-full">Дозаказ</span>}
                  </div>
                  <span className="font-bold">{Number(o.total_price).toLocaleString()} ₸</span>
                </div>
                <div className="text-xs text-stone-400">
                  {o.order_items?.map((oi) => `${oi.item_title_snapshot} ×${oi.quantity}`).join(', ')}
                </div>
                {o.status === 'new' && (
                  <button
                    onClick={async () => {
                      await supabase.rpc('cancel_order_with_audit', { p_order_id: o.id, p_reason: 'Отмена гостем', p_actor: profile.name });
                      notify('Заказ отменен, бонусы возвращены.');
                      fetchAll();
                    }}
                    className="text-xs text-red-400 hover:underline"
                  >
                    Отменить заказ
                  </button>
                )}
                {o.status === 'completed' && (
                  <div className="pt-2 border-t border-stone-800 flex flex-wrap items-center gap-2 text-xs">
                    <span className="text-stone-400">Оценить заказ:</span>
                    {[1, 2, 3, 4, 5].map((star) => (
                      <button key={star} onClick={() => submitReview(o.id, star, `Оценка ${star}/5`, star >= 4 ? 500 : 0)} className="p-1 hover:text-amber-400">
                        <Star className="w-4 h-4 fill-amber-500/20 text-amber-400" />
                      </button>
                    ))}
                    <span className="text-[11px] text-stone-500">(4–5★ = +100 бонусов и 500₸ чаевых)</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'booking' && (
        <form onSubmit={submitBooking} className="max-w-lg bg-stone-900 border border-stone-800 p-6 rounded-2xl space-y-4">
          <h2 className="font-bold text-lg text-amber-400">Бронирование столика или VIP-кабинки</h2>
          <input required placeholder="Ваше имя" value={booking.guest_name} onChange={(e) => setBooking({ ...booking, guest_name: e.target.value })} className="w-full bg-stone-950 border border-stone-700 rounded-lg px-3 py-2 text-sm" />
          <input required placeholder="Телефон" value={booking.phone} onChange={(e) => setBooking({ ...booking, phone: e.target.value })} className="w-full bg-stone-950 border border-stone-700 rounded-lg px-3 py-2 text-sm" />
          <div className="grid grid-cols-2 gap-3">
            <select value={booking.zone} onChange={(e) => setBooking({ ...booking, zone: e.target.value })} className="bg-stone-950 border border-stone-700 rounded-lg px-3 py-2 text-sm">
              <option value="main_hall">Основной зал</option>
              <option value="terrace">Летняя терраса</option>
              <option value="vip_room">VIP-кабинка</option>
            </select>
            <input type="number" min="1" max="20" placeholder="Гостей" value={booking.guests_count} onChange={(e) => setBooking({ ...booking, guests_count: Number(e.target.value) })} className="bg-stone-950 border border-stone-700 rounded-lg px-3 py-2 text-sm" />
          </div>
          <input type="datetime-local" required value={booking.reserved_for} onChange={(e) => setBooking({ ...booking, reserved_for: e.target.value })} className="w-full bg-stone-950 border border-stone-700 rounded-lg px-3 py-2 text-sm" />
          <div>
            <label className="text-xs text-stone-400">Депозит (₸) — зачисляется в кассу</label>
            <input type="number" value={booking.deposit_amount} onChange={(e) => setBooking({ ...booking, deposit_amount: Number(e.target.value) })} className="w-full bg-stone-950 border border-stone-700 rounded-lg px-3 py-2 text-sm mt-1" />
          </div>
          <button type="submit" className="w-full py-2.5 bg-amber-500 text-stone-950 font-bold rounded-xl">Забронировать</button>
        </form>
      )}

      {selectedDish && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4 z-50">
          <div className="bg-stone-900 border border-stone-700 rounded-2xl p-5 max-w-sm w-full space-y-4">
            <h3 className="font-bold text-lg">{selectedDish.title}</h3>
            <div className="space-y-2">
              {selectedDish.modifiers.map((mod) => (
                <label key={mod} className="flex items-center gap-2 text-sm bg-stone-950 p-2.5 rounded-lg cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedMods.includes(mod)}
                    onChange={(e) => setSelectedMods(e.target.checked ? [...selectedMods, mod] : selectedMods.filter((m) => m !== mod))}
                  />
                  {mod}
                </label>
              ))}
            </div>
            <div className="flex gap-2">
              <button onClick={() => setSelectedDish(null)} className="flex-1 py-2 bg-stone-800 rounded-lg text-sm">Отмена</button>
              <button onClick={() => addToCart(selectedDish, selectedMods)} className="flex-1 py-2 bg-amber-500 text-stone-950 font-bold rounded-lg text-sm">Добавить</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
