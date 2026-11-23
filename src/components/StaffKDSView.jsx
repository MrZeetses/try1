import React, { useEffect, useState } from 'react';
import { Bell, Clock, Ban, CheckCircle, Truck, Flame, XCircle } from 'lucide-react';
import { getSupabase } from '../lib/supabase';

export default function StaffKDSView({ mode = 'kds' }) {
  const supabase = getSupabase();
  const [orders, setOrders] = useState([]);
  const [requests, setRequests] = useState([]);
  const [menu, setMenu] = useState([]);
  const [highLoad, setHighLoad] = useState(false);
  const [showStopList, setShowStopList] = useState(false);

  const playBeep = () => {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.18);
    } catch {}
  };

  const loadData = async () => {
    const [{ data: o }, { data: r }, { data: m }] = await Promise.all([
      supabase.from('orders').select('*, order_items(*)').in('status', ['new', 'cooking', 'ready', 'delivering']).order('created_at'),
      supabase.from('service_requests').select('*').eq('status', 'pending').order('created_at'),
      supabase.from('menu_items').select('id, title, in_stock, category').order('title')
    ]);
    if (o) setOrders(o);
    if (r) setRequests(r);
    if (m) setMenu(m);
  };

  useEffect(() => {
    loadData();
    const channel = supabase
      .channel('kds-realtime')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orders' }, () => {
        playBeep();
        loadData();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, loadData)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'service_requests' }, loadData)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'menu_items' }, loadData)
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, []);

  const updateStatus = async (orderId, nextStatus) => {
    if (nextStatus === 'completed') {
      await supabase.rpc('complete_order', { p_order_id: orderId });
    } else {
      await supabase.from('orders').update({ status: nextStatus }).eq('id', orderId);
    }
    loadData();
  };

  const cancelOrder = async (orderId) => {
    const reason = window.prompt('Причина отмены (например: "Брак кухни" или "Отказ гостя"):', 'Брак кухни');
    if (!reason) return;
    await supabase.rpc('cancel_order_with_audit', { p_order_id: orderId, p_reason: reason, p_actor: 'Шеф-повар KDS' });
    loadData();
  };

  const toggleStock = async (item) => {
    await supabase.from('menu_items').update({ in_stock: !item.in_stock }).eq('id', item.id);
    loadData();
  };

  const resolveRequest = async (id) => {
    await supabase.from('service_requests').update({ status: 'resolved' }).eq('id', id);
    loadData();
  };

  const getSlaColor = (createdAt) => {
    const mins = Math.floor((Date.now() - new Date(createdAt).getTime()) / 60000);
    if (mins >= 25) return { color: 'border-red-500 bg-red-950/30 text-red-400', mins };
    if (mins >= 15) return { color: 'border-amber-500 bg-amber-950/30 text-amber-400', mins };
    return { color: 'border-emerald-500/50 bg-stone-900 text-emerald-400', mins };
  };

  if (mode === 'courier') {
    const deliveries = orders.filter((o) => o.order_type === 'delivery');
    return (
      <div className="max-w-4xl mx-auto p-4 space-y-4">
        <h2 className="text-xl font-bold flex items-center gap-2 text-amber-400"><Truck /> Кабинет курьера ({deliveries.length})</h2>
        <div className="grid gap-4">
          {deliveries.map((o) => (
            <div key={o.id} className="bg-stone-900 border border-stone-800 p-4 rounded-2xl flex flex-wrap justify-between items-center gap-4">
              <div>
                <p className="font-bold text-lg">Заказ #{o.id} • {Number(o.total_price).toLocaleString()} ₸ ({o.payment_method})</p>
                <p className="text-sm text-amber-300">Адрес: {o.delivery_address || 'Не указан'}</p>
                <p className="text-xs text-stone-400 mt-1">{o.order_items?.map((i) => `${i.item_title_snapshot} ×${i.quantity}`).join(', ')}</p>
              </div>
              <div className="flex gap-2">
                {o.status === 'ready' && (
                  <button onClick={() => updateStatus(o.id, 'delivering')} className="px-4 py-2 bg-blue-600 rounded-xl text-sm font-semibold">Забрал заказ</button>
                )}
                {o.status === 'delivering' && (
                  <button onClick={() => updateStatus(o.id, 'completed')} className="px-4 py-2 bg-emerald-600 rounded-xl text-sm font-semibold">Доставлен (Завершить)</button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const columns = [
    { id: 'new', title: 'Новые', next: 'cooking', btn: 'В работу' },
    { id: 'cooking', title: 'Готовятся', next: 'ready', btn: 'Готово' },
    { id: 'ready', title: 'Готовы к выдаче', next: 'completed', btn: 'Выдать и закрыть' }
  ];

  return (
    <div className="max-w-7xl mx-auto p-4 space-y-4">
      <div className="flex flex-wrap justify-between items-center gap-3 bg-stone-900 border border-stone-800 p-3 rounded-2xl">
        <div className="flex items-center gap-3">
          <h2 className="font-bold text-lg text-amber-400">KDS Кухня и Зал</h2>
          <button
            onClick={() => setHighLoad(!highLoad)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 ${highLoad ? 'bg-red-600 text-white' : 'bg-stone-800 text-stone-300'}`}
          >
            <Flame className="w-3.5 h-3.5" /> {highLoad ? 'Высокая нагрузка (+20 мин)' : 'Штатный режим'}
          </button>
        </div>
        <button onClick={() => setShowStopList(!showStopList)} className="px-3.5 py-1.5 bg-stone-800 hover:bg-stone-700 rounded-lg text-xs font-semibold flex items-center gap-1.5">
          <Ban className="w-3.5 h-3.5 text-red-400" /> Стоп-лист ({menu.filter((m) => !m.in_stock).length})
        </button>
      </div>

      {requests.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {requests.map((r) => (
            <div key={r.id} className="bg-amber-500/20 border border-amber-500 text-amber-300 px-3 py-2 rounded-xl text-xs flex items-center gap-3">
              <Bell className="w-4 h-4 animate-bounce" />
              <span><b>Стол №{r.table_number}:</b> {r.request_type === 'call_waiter' ? 'Вызов официанта' : 'Запрос счета / терминала'}</span>
              <button onClick={() => resolveRequest(r.id)} className="bg-amber-500 text-stone-950 px-2 py-0.5 rounded font-bold">Принято</button>
            </div>
          ))}
        </div>
      )}

      {showStopList && (
        <div className="bg-stone-900 border border-stone-800 p-4 rounded-2xl grid grid-cols-2 sm:grid-cols-4 gap-2">
          {menu.map((item) => (
            <button
              key={item.id}
              onClick={() => toggleStock(item)}
              className={`p-2 rounded-lg text-xs text-left border ${item.in_stock ? 'border-stone-800 bg-stone-950 text-stone-200' : 'border-red-600 bg-red-950/40 text-red-300 line-through'}`}
            >
              {item.title}
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {columns.map((col) => (
          <div key={col.id} className="bg-stone-900/60 border border-stone-800 rounded-2xl p-3 space-y-3">
            <h3 className="font-bold text-sm uppercase tracking-wider text-stone-400 px-1">
              {col.title} ({orders.filter((o) => o.status === col.id).length})
            </h3>
            {orders.filter((o) => o.status === col.id).map((o) => {
              const sla = getSlaColor(o.created_at);
              return (
                <div key={o.id} className={`border rounded-xl p-3.5 space-y-2.5 ${sla.color}`}>
                  <div className="flex justify-between items-center text-xs font-bold">
                    <span>#{o.id} • {o.order_type === 'table' ? `Стол №${o.table_number}` : o.order_type.toUpperCase()}</span>
                    <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> {sla.mins} мин</span>
                  </div>
                  <ul className="text-sm text-stone-100 space-y-1 border-y border-stone-800 py-2">
                    {o.order_items?.map((oi) => (
                      <li key={oi.id}>
                        <b>{oi.quantity}×</b> {oi.item_title_snapshot}
                        {oi.selected_modifiers?.length > 0 && (
                          <span className="block text-[11px] text-amber-400 pl-4">↳ {oi.selected_modifiers.join(', ')}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                  {o.comment && <p className="text-xs text-amber-300 italic">«{o.comment}»</p>}
                  <div className="flex gap-2">
                    <button onClick={() => updateStatus(o.id, col.next)} className="flex-1 py-2 bg-amber-500 hover:bg-amber-400 text-stone-950 font-bold rounded-lg text-xs flex items-center justify-center gap-1">
                      <CheckCircle className="w-3.5 h-3.5" /> {col.btn}
                    </button>
                    <button onClick={() => cancelOrder(o.id)} className="p-2 bg-red-950/60 hover:bg-red-900 text-red-400 rounded-lg" title="Отменить">
                      <XCircle className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
