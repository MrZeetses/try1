import React, { useEffect, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid
} from 'recharts';
import { Download, AlertTriangle, Plus } from 'lucide-react';
import { getSupabase } from '../lib/supabase';

export default function AccountantERPView() {
  const supabase = getSupabase();
  const [tab, setTab] = useState('pnl');
  const [data, setData] = useState({
    orders: [], orderItems: [], tx: [], shifts: [], ingredients: [],
    recipes: [], staff: [], suppliers: [], payments: [], logs: [], menu: []
  });

  const [expForm, setExpForm] = useState({ category: 'Аренда', amount: '', payment_source: 'bank_account', description: '' });
  const [stockForm, setStockForm] = useState({ ingredient_id: '', qty: '', unit_cost: '' });

  const loadAll = async () => {
    const [
      orders, orderItems, tx, shifts, ingredients,
      recipes, staff, suppliers, payments, logs, menu
    ] = await Promise.all([
      supabase.from('orders').select('*').order('created_at', { ascending: false }),
      supabase.from('order_items').select('*'),
      supabase.from('accounting_transactions').select('*').order('created_at', { ascending: false }),
      supabase.from('cash_shifts').select('*').order('opened_at', { ascending: false }),
      supabase.from('ingredients').select('*').order('name'),
      supabase.from('recipes').select('*, menu_items(title, price), ingredients(name, avg_cost)'),
      supabase.from('staff_members').select('*'),
      supabase.from('suppliers').select('*'),
      supabase.from('scheduled_payments').select('*').order('due_date'),
      supabase.from('audit_logs').select('*').order('created_at', { ascending: false }),
      supabase.from('menu_items').select('*')
    ]);
    setData({
      orders: orders.data || [], orderItems: orderItems.data || [], tx: tx.data || [],
      shifts: shifts.data || [], ingredients: ingredients.data || [], recipes: recipes.data || [],
      staff: staff.data || [], suppliers: suppliers.data || [], payments: payments.data || [],
      logs: logs.data || [], menu: menu.data || []
    });
  };

  useEffect(() => {
    loadAll();
    const ch = supabase
      .channel('erp-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'accounting_transactions' }, loadAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ingredients' }, loadAll)
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, []);

  const completedOrders = data.orders.filter((o) => o.status === 'completed');
  const netRevenue = data.tx.filter((t) => t.type === 'income').reduce((s, t) => s + Number(t.amount), 0);
  const cogs = completedOrders.reduce((s, o) => s + Number(o.cogs_total), 0);
  const foodCostPct = netRevenue > 0 ? ((cogs / netRevenue) * 100).toFixed(1) : 0;
  const opex = data.tx.filter((t) => t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0);
  const netProfit = netRevenue - cogs - opex;
  const marginPct = netRevenue > 0 ? ((netProfit / netRevenue) * 100).toFixed(1) : 0;

  const hallOrders = completedOrders.filter((o) => o.order_type === 'table');
  const delOrders = completedOrders.filter((o) => o.order_type === 'delivery');
  const avgHall = hallOrders.length ? Math.round(hallOrders.reduce((s, o) => s + Number(o.total_price), 0) / hallOrders.length) : 0;
  const avgDel = delOrders.length ? Math.round(delOrders.reduce((s, o) => s + Number(o.total_price), 0) / delOrders.length) : 0;

  const chartData = [
    { name: 'Выручка', value: netRevenue },
    { name: 'Food Cost', value: cogs },
    { name: 'Расходы', value: opex },
    { name: 'Прибыль', value: Math.max(0, netProfit) }
  ];

  const addExpense = async (e) => {
    e.preventDefault();
    await supabase.from('accounting_transactions').insert({
      type: 'expense', category: expForm.category, amount: Number(expForm.amount),
      payment_source: expForm.payment_source, description: expForm.description
    });
    setExpForm({ category: 'Аренда', amount: '', payment_source: 'bank_account', description: '' });
    loadAll();
  };

  const addStockReceipt = async (e) => {
    e.preventDefault();
    const ing = data.ingredients.find((i) => i.id === stockForm.ingredient_id);
    if (!ing) return;
    const qty = Number(stockForm.qty);
    const cost = Number(stockForm.unit_cost);
    const newQty = Number(ing.stock_qty) + qty;
    const newAvg = ((Number(ing.stock_qty) * Number(ing.avg_cost)) + (qty * cost)) / newQty;

    await supabase.from('ingredients').update({ stock_qty: newQty, avg_cost: Math.round(newAvg) }).eq('id', ing.id);
    await supabase.from('accounting_transactions').insert({
      type: 'expense', category: 'Закуп продуктов', amount: qty * cost,
      payment_source: 'bank_account', description: `Приход на склад: ${ing.name} (${qty} ${ing.unit})`
    });
    setStockForm({ ingredient_id: '', qty: '', unit_cost: '' });
    loadAll();
  };

  const closeShift = async (shift) => {
    const actual = Number(window.prompt('Фактическая наличность в кассе (₸):', shift.expected_cash));
    if (isNaN(actual)) return;
    await supabase.from('cash_shifts').update({ status: 'closed', closed_at: new Date().toISOString(), actual_cash: actual }).eq('id', shift.id);
    await supabase.from('cash_shifts').insert({ status: 'open', opening_cash: actual, expected_cash: actual, total_card: 0, total_online: 0 });
    loadAll();
  };

  const paySalary = async (member) => {
    const totalPay = (member.shifts_worked * member.shift_rate) + Math.round(netRevenue * (member.sales_percent / 100)) + Number(member.tips_earned) - Number(member.advances_paid);
    await supabase.from('accounting_transactions').insert({
      type: 'expense', category: 'ФОТ (Зарплата)', amount: Math.max(0, totalPay),
      payment_source: 'bank_account', description: `Выплата ЗП: ${member.name}`
    });
    await supabase.from('staff_members').update({ shifts_worked: 0, advances_paid: 0, tips_earned: 0 }).eq('id', member.id);
    loadAll();
  };

  const exportCSV = () => {
    const rows = [['ID', 'Тип', 'Категория', 'Сумма', 'Источник', 'Описание', 'Дата']];
    data.tx.forEach((t) => rows.push([t.id, t.type, t.category, t.amount, t.payment_source, t.description, t.created_at]));
    const csv = 'data:text/csv;charset=utf-8,' + rows.map((r) => r.join(',')).join('\n');
    const a = document.createElement('a');
    a.href = encodeURI(csv);
    a.download = 'samarkand_erp_report.csv';
    a.click();
  };

  const abcStats = data.menu.map((m) => {
    const sold = data.orderItems.filter((oi) => oi.menu_item_id === m.id);
    const qty = sold.reduce((s, i) => s + i.quantity, 0);
    const rev = sold.reduce((s, i) => s + (i.price_at_moment * i.quantity), 0);
    const cost = sold.reduce((s, i) => s + (i.cost_at_moment * i.quantity), 0);
    const profit = rev - cost;
    const group = qty >= 3 && profit >= 3000 ? 'Звезда' : qty >= 3 ? 'Рабочая лошадка' : profit >= 3000 ? 'Загадка' : 'Собака';
    return { title: m.title, qty, rev, profit, group };
  }).sort((a, b) => b.profit - a.profit);

  const tabs = [
    ['pnl', '1. P&L Дашборд'], ['shifts', '2. Касса / Z-отчет'], ['tx', '3. Транзакции'],
    ['stock', '4. Склад и Техкарты'], ['staff', '5. Зарплаты (ФОТ)'], ['suppliers', '6. Поставщики и Календарь'],
    ['abc', '7. ABC-анализ'], ['audit', '8. Налоги и Антифрод']
  ];

  return (
    <div className="max-w-7xl mx-auto p-4 space-y-5">
      <div className="flex flex-wrap gap-1.5 bg-stone-900 p-2 rounded-2xl border border-stone-800">
        {tabs.map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} className={`px-3 py-1.5 rounded-xl text-xs font-semibold ${tab === id ? 'bg-amber-500 text-stone-950' : 'text-stone-400 hover:bg-stone-800'}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'pnl' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-stone-900 border border-stone-800 p-4 rounded-xl"><p className="text-xs text-stone-400">Чистая выручка</p><p className="text-xl font-bold text-emerald-400">{netRevenue.toLocaleString()} ₸</p></div>
            <div className="bg-stone-900 border border-stone-800 p-4 rounded-xl">
              <p className="text-xs text-stone-400">Food Cost %</p>
              <p className={`text-xl font-bold ${Number(foodCostPct) > 35 ? 'text-red-400' : 'text-amber-400'}`}>{foodCostPct}%</p>
              {Number(foodCostPct) > 35 && <span className="text-[10px] text-red-400 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Выше нормы 35%</span>}
            </div>
            <div className="bg-stone-900 border border-stone-800 p-4 rounded-xl"><p className="text-xs text-stone-400">Чистая прибыль</p><p className="text-xl font-bold text-white">{netProfit.toLocaleString()} ₸ ({marginPct}%)</p></div>
            <div className="bg-stone-900 border border-stone-800 p-4 rounded-xl"><p className="text-xs text-stone-400">Ср. чек (Зал / Доставка)</p><p className="text-sm font-bold text-amber-300 mt-1">{avgHall} ₸ / {avgDel} ₸</p></div>
          </div>
          <div className="bg-stone-900 border border-stone-800 p-5 rounded-2xl h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#292524" />
                <XAxis dataKey="name" stroke="#a8a29e" fontSize={12} />
                <YAxis stroke="#a8a29e" fontSize={12} />
                <Tooltip contentStyle={{ backgroundColor: '#1c1917', border: '1px solid #44403c' }} />
                <Bar dataKey="value" fill="#f59e0b" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {tab === 'shifts' && (
        <div className="space-y-3">
          {data.shifts.map((s) => (
            <div key={s.id} className="bg-stone-900 border border-stone-800 p-4 rounded-xl flex flex-wrap justify-between items-center gap-4 text-sm">
              <div>
                <p className="font-bold">{s.status === 'open' ? '🟢 Открытая смена' : '⚪ Закрытая смена (Z-отчет)'}</p>
                <p className="text-xs text-stone-400">Наличные (ожид.): {s.expected_cash} ₸ • POS: {s.total_card} ₸ • Онлайн: {s.total_online} ₸</p>
                {s.status === 'closed' && <p className="text-xs text-amber-400">Факт: {s.actual_cash} ₸ (Разница: {s.actual_cash - s.expected_cash} ₸)</p>}
              </div>
              {s.status === 'open' && <button onClick={() => closeShift(s)} className="px-4 py-2 bg-amber-500 text-stone-950 font-bold rounded-lg text-xs">Снять Z-отчет и закрыть</button>}
            </div>
          ))}
        </div>
      )}

      {tab === 'tx' && (
        <div className="space-y-4">
          <form onSubmit={addExpense} className="bg-stone-900 border border-stone-800 p-4 rounded-xl grid grid-cols-1 md:grid-cols-5 gap-2">
            <input placeholder="Категория" value={expForm.category} onChange={(e) => setExpForm({ ...expForm, category: e.target.value })} className="bg-stone-950 border border-stone-700 rounded-lg px-3 py-2 text-xs" />
            <input type="number" required placeholder="Сумма (₸)" value={expForm.amount} onChange={(e) => setExpForm({ ...expForm, amount: e.target.value })} className="bg-stone-950 border border-stone-700 rounded-lg px-3 py-2 text-xs" />
            <select value={expForm.payment_source} onChange={(e) => setExpForm({ ...expForm, payment_source: e.target.value })} className="bg-stone-950 border border-stone-700 rounded-lg px-3 py-2 text-xs">
              <option value="bank_account">Банк</option><option value="cash_register">Касса</option>
            </select>
            <input placeholder="Описание" value={expForm.description} onChange={(e) => setExpForm({ ...expForm, description: e.target.value })} className="bg-stone-950 border border-stone-700 rounded-lg px-3 py-2 text-xs" />
            <button type="submit" className="bg-red-600 text-white font-bold rounded-lg text-xs flex items-center justify-center gap-1"><Plus className="w-3.5 h-3.5" /> Расход</button>
          </form>
          <div className="bg-stone-900 border border-stone-800 rounded-xl overflow-hidden">
            <table className="w-full text-xs text-left">
              <thead className="bg-stone-950 text-stone-400"><tr><th className="p-3">Тип</th><th className="p-3">Категория</th><th className="p-3">Сумма</th><th className="p-3">Источник</th><th className="p-3">Описание</th></tr></thead>
              <tbody>
                {data.tx.map((t) => (
                  <tr key={t.id} className="border-t border-stone-800">
                    <td className={`p-3 font-bold ${t.type === 'income' ? 'text-emerald-400' : 'text-red-400'}`}>{t.type === 'income' ? 'Приход' : 'Расход'}</td>
                    <td className="p-3">{t.category}</td>
                    <td className="p-3 font-bold">{Number(t.amount).toLocaleString()} ₸</td>
                    <td className="p-3 text-stone-400">{t.payment_source}</td>
                    <td className="p-3 text-stone-400">{t.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'stock' && (
        <div className="space-y-4">
          <form onSubmit={addStockReceipt} className="bg-stone-900 border border-stone-800 p-4 rounded-xl grid grid-cols-1 md:grid-cols-4 gap-2">
            <select required value={stockForm.ingredient_id} onChange={(e) => setStockForm({ ...stockForm, ingredient_id: e.target.value })} className="bg-stone-950 border border-stone-700 rounded-lg px-3 py-2 text-xs">
              <option value="">Выберите продукт...</option>
              {data.ingredients.map((i) => <option key={i.id} value={i.id}>{i.name} ({i.unit})</option>)}
            </select>
            <input type="number" step="0.1" required placeholder="Кол-во" value={stockForm.qty} onChange={(e) => setStockForm({ ...stockForm, qty: e.target.value })} className="bg-stone-950 border border-stone-700 rounded-lg px-3 py-2 text-xs" />
            <input type="number" required placeholder="Цена за ед. (₸)" value={stockForm.unit_cost} onChange={(e) => setStockForm({ ...stockForm, unit_cost: e.target.value })} className="bg-stone-950 border border-stone-700 rounded-lg px-3 py-2 text-xs" />
            <button type="submit" className="bg-emerald-600 text-white font-bold rounded-lg text-xs">Оформить приход</button>
          </form>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
            {data.ingredients.map((i) => (
              <div key={i.id} className={`p-3.5 rounded-xl border ${Number(i.stock_qty) <= Number(i.min_threshold) ? 'border-red-500 bg-red-950/20' : 'border-stone-800 bg-stone-900'}`}>
                <p className="font-bold text-sm">{i.name}</p>
                <p className="text-lg font-bold text-amber-400 mt-1">{Number(i.stock_qty).toFixed(2)} {i.unit}</p>
                <p className="text-xs text-stone-400">Ср. цена: {Number(i.avg_cost).toLocaleString()} ₸/{i.unit}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'staff' && (
        <div className="grid gap-3">
          {data.staff.map((m) => {
            const total = (m.shifts_worked * m.shift_rate) + Math.round(netRevenue * (m.sales_percent / 100)) + Number(m.tips_earned) - Number(m.advances_paid);
            return (
              <div key={m.id} className="bg-stone-900 border border-stone-800 p-4 rounded-xl flex flex-wrap justify-between items-center gap-3 text-sm">
                <div>
                  <p className="font-bold">{m.name} — <span className="text-amber-400">{m.position}</span></p>
                  <p className="text-xs text-stone-400">Смен: {m.shifts_worked} × {m.shift_rate}₸ | % продаж: {m.sales_percent}% | Чаевые: {m.tips_earned}₸ | Аванс: -{m.advances_paid}₸</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-bold text-emerald-400">{Math.max(0, total).toLocaleString()} ₸</span>
                  <button onClick={() => paySalary(m)} className="px-3 py-1.5 bg-amber-500 text-stone-950 font-bold rounded-lg text-xs">Выплатить ЗП</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {tab === 'suppliers' && (
        <div className="grid md:grid-cols-2 gap-4">
          <div className="bg-stone-900 border border-stone-800 p-4 rounded-xl space-y-3">
            <h3 className="font-bold text-amber-400">Кредиторка поставщикам</h3>
            {data.suppliers.map((s) => (
              <div key={s.id} className="flex justify-between items-center text-sm border-b border-stone-800 pb-2">
                <div><p className="font-medium">{s.name}</p><p className="text-xs text-stone-400">{s.category}</p></div>
                <div className="flex items-center gap-2">
                  <span className="text-red-400 font-bold">{Number(s.debt_amount).toLocaleString()} ₸</span>
                  {Number(s.debt_amount) > 0 && (
                    <button onClick={async () => {
                      await supabase.from('accounting_transactions').insert({ type: 'expense', category: 'Оплата поставщику', amount: s.debt_amount, payment_source: 'bank_account', supplier_id: s.id, description: s.name });
                      await supabase.from('suppliers').update({ debt_amount: 0 }).eq('id', s.id);
                      loadAll();
                    }} className="px-2 py-1 bg-stone-800 rounded text-xs">Погасить</button>
                  )}
                </div>
              </div>
            ))}
          </div>
          <div className="bg-stone-900 border border-stone-800 p-4 rounded-xl space-y-3">
            <h3 className="font-bold text-amber-400">Платёжный календарь</h3>
            {data.payments.map((p) => (
              <div key={p.id} className="flex justify-between items-center text-sm border-b border-stone-800 pb-2">
                <div><p className="font-medium">{p.title}</p><p className="text-xs text-stone-400">До {p.due_date}</p></div>
                <span className={p.is_paid ? 'text-emerald-400 line-through' : 'text-amber-300 font-bold'}>{Number(p.amount).toLocaleString()} ₸</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'abc' && (
        <div className="bg-stone-900 border border-stone-800 rounded-xl overflow-hidden">
          <table className="w-full text-xs text-left">
            <thead className="bg-stone-950 text-stone-400"><tr><th className="p-3">Блюдо</th><th className="p-3">Продано (шт)</th><th className="p-3">Выручка</th><th className="p-3">Валовая прибыль</th><th className="p-3">Категория ABC</th></tr></thead>
            <tbody>
              {abcStats.map((a) => (
                <tr key={a.title} className="border-t border-stone-800">
                  <td className="p-3 font-medium">{a.title}</td>
                  <td className="p-3">{a.qty}</td>
                  <td className="p-3">{a.rev.toLocaleString()} ₸</td>
                  <td className="p-3 text-emerald-400 font-bold">{a.profit.toLocaleString()} ₸</td>
                  <td className="p-3"><span className="px-2 py-0.5 rounded bg-stone-800">{a.group}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'audit' && (
        <div className="space-y-4">
          <div className="bg-stone-900 border border-stone-800 p-4 rounded-xl flex flex-wrap justify-between items-center gap-3">
            <div>
              <p className="text-xs text-stone-400">Налог с оборота (3% упрощенка)</p>
              <p className="text-2xl font-bold text-amber-400">{Math.round(netRevenue * 0.03).toLocaleString()} ₸</p>
            </div>
            <button onClick={exportCSV} className="px-4 py-2 bg-emerald-600 text-white font-bold rounded-xl text-xs flex items-center gap-2">
              <Download className="w-4 h-4" /> Экспорт в CSV
            </button>
          </div>
          <div className="bg-stone-900 border border-stone-800 p-4 rounded-xl space-y-2">
            <h3 className="font-bold text-red-400 text-sm">Антифрод-журнал (audit_logs)</h3>
            {data.logs.map((l) => (
              <div key={l.id} className="text-xs border-b border-stone-800 pb-2 flex justify-between">
                <span><b>{l.actor_name}</b> — {l.action}: {l.details}</span>
                <span className="text-stone-500">{new Date(l.created_at).toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
