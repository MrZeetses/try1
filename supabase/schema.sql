-- ============================================================================
-- РЕСТОРАН ВОСТОЧНОЙ КУХНИ «САМАРКАНД» — ПОЛНАЯ СХЕМА БД SUPABASE (POSTGRESQL)
-- ============================================================================

CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  phone text UNIQUE,
  role text NOT NULL DEFAULT 'client' CHECK (role IN ('client', 'cook', 'waiter', 'courier', 'accountant')),
  bonus_balance numeric NOT NULL DEFAULT 0,
  pending_bonus numeric NOT NULL DEFAULT 0,
  total_spent numeric NOT NULL DEFAULT 0,
  loyalty_tier text NOT NULL DEFAULT 'bronze' CHECK (loyalty_tier IN ('bronze', 'silver', 'gold'))
);

CREATE TABLE IF NOT EXISTS menu_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text,
  category text NOT NULL,
  price numeric NOT NULL,
  weight text,
  image_url text,
  is_popular boolean DEFAULT false,
  is_spicy boolean DEFAULT false,
  in_stock boolean DEFAULT true,
  station text NOT NULL DEFAULT 'hot_kitchen' CHECK (station IN ('hot_kitchen', 'cold_bar')),
  modifiers jsonb DEFAULT '[]'::jsonb
);

CREATE TABLE IF NOT EXISTS ingredients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  unit text NOT NULL CHECK (unit IN ('кг', 'л', 'шт')),
  stock_qty numeric NOT NULL DEFAULT 0,
  avg_cost numeric NOT NULL DEFAULT 0,
  min_threshold numeric NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS recipes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  menu_item_id uuid NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  ingredient_id uuid NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
  qty_required numeric NOT NULL
);

CREATE TABLE IF NOT EXISTS promocodes (
  code text PRIMARY KEY,
  discount_type text NOT NULL CHECK (discount_type IN ('percent', 'fixed')),
  discount_value numeric NOT NULL,
  is_active boolean DEFAULT true
);

CREATE TABLE IF NOT EXISTS orders (
  id serial PRIMARY KEY,
  user_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  order_type text NOT NULL CHECK (order_type IN ('table', 'delivery', 'pickup')),
  table_number int,
  is_addon_order boolean DEFAULT false,
  delivery_address text,
  comment text,
  payment_method text NOT NULL CHECK (payment_method IN ('cash', 'card_pos', 'online')),
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'cooking', 'ready', 'delivering', 'completed', 'cancelled')),
  cancel_reason text,
  subtotal numeric NOT NULL DEFAULT 0,
  discount_amount numeric NOT NULL DEFAULT 0,
  bonus_used numeric NOT NULL DEFAULT 0,
  delivery_fee numeric NOT NULL DEFAULT 0,
  total_price numeric NOT NULL DEFAULT 0,
  cogs_total numeric NOT NULL DEFAULT 0,
  cashback_earned numeric NOT NULL DEFAULT 0,
  tips_amount numeric DEFAULT 0,
  waiter_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  courier_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id int NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  menu_item_id uuid REFERENCES menu_items(id) ON DELETE SET NULL,
  item_title_snapshot text NOT NULL,
  quantity int NOT NULL,
  price_at_moment numeric NOT NULL,
  cost_at_moment numeric NOT NULL DEFAULT 0,
  selected_modifiers jsonb DEFAULT '[]'::jsonb
);

CREATE TABLE IF NOT EXISTS reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guest_name text NOT NULL,
  phone text NOT NULL,
  zone text NOT NULL CHECK (zone IN ('main_hall', 'terrace', 'vip_room')),
  table_number int NOT NULL,
  guests_count int NOT NULL,
  reserved_for timestamptz NOT NULL,
  deposit_amount numeric DEFAULT 0,
  status text NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'seated', 'completed', 'no_show'))
);

CREATE TABLE IF NOT EXISTS service_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_number int NOT NULL,
  request_type text NOT NULL CHECK (request_type IN ('call_waiter', 'request_bill', 'cancel_request')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'resolved')),
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id int NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  rating int NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment text,
  is_public boolean DEFAULT true,
  manager_resolved boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cash_shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opened_at timestamptz DEFAULT now(),
  closed_at timestamptz,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  opening_cash numeric NOT NULL DEFAULT 0,
  expected_cash numeric NOT NULL DEFAULT 0,
  actual_cash numeric DEFAULT 0,
  total_card numeric NOT NULL DEFAULT 0,
  total_online numeric NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  category text NOT NULL,
  debt_amount numeric NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS accounting_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL CHECK (type IN ('income', 'expense')),
  category text NOT NULL,
  amount numeric NOT NULL,
  payment_source text NOT NULL CHECK (payment_source IN ('cash_register', 'bank_account')),
  supplier_id uuid REFERENCES suppliers(id) ON DELETE SET NULL,
  order_id int REFERENCES orders(id) ON DELETE CASCADE,
  description text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS staff_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  position text NOT NULL,
  shift_rate numeric NOT NULL DEFAULT 0,
  sales_percent numeric NOT NULL DEFAULT 0,
  shifts_worked int NOT NULL DEFAULT 0,
  advances_paid numeric NOT NULL DEFAULT 0,
  tips_earned numeric NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS scheduled_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  category text NOT NULL,
  amount numeric NOT NULL,
  due_date date NOT NULL,
  is_paid boolean DEFAULT false
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_name text NOT NULL,
  action text NOT NULL,
  details text,
  created_at timestamptz DEFAULT now()
);

CREATE OR REPLACE FUNCTION create_full_order(
  p_user_id uuid,
  p_order_type text,
  p_table_number int,
  p_is_addon_order boolean,
  p_delivery_address text,
  p_comment text,
  p_payment_method text,
  p_discount_amount numeric,
  p_bonus_used numeric,
  p_delivery_fee numeric,
  p_items jsonb
) RETURNS jsonb AS $$
DECLARE
  v_item jsonb;
  v_menu_item record;
  v_user record;
  v_subtotal numeric := 0;
  v_cogs_total numeric := 0;
  v_item_cost numeric := 0;
  v_total_price numeric := 0;
  v_cashback_rate numeric := 0.01;
  v_cashback_earned numeric := 0;
  v_order_id int;
  v_result jsonb;
BEGIN
  SELECT * INTO v_user FROM profiles WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Пользователь не найден'; END IF;
  IF p_bonus_used > v_user.bonus_balance THEN RAISE EXCEPTION 'Недостаточно бонусов на балансе'; END IF;

  IF v_user.loyalty_tier = 'gold' THEN v_cashback_rate := 0.07;
  ELSIF v_user.loyalty_tier = 'silver' THEN v_cashback_rate := 0.04;
  ELSE v_cashback_rate := 0.01;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    SELECT * INTO v_menu_item FROM menu_items WHERE id = (v_item->>'menu_item_id')::uuid;
    IF NOT FOUND OR NOT v_menu_item.in_stock THEN
      RAISE EXCEPTION 'Блюдо "%" временно в стоп-листе', COALESCE(v_menu_item.title, 'Неизвестно');
    END IF;
    v_subtotal := v_subtotal + (v_menu_item.price * (v_item->>'quantity')::int);
    SELECT COALESCE(SUM(r.qty_required * i.avg_cost), 0) INTO v_item_cost
    FROM recipes r JOIN ingredients i ON i.id = r.ingredient_id WHERE r.menu_item_id = v_menu_item.id;
    v_cogs_total := v_cogs_total + (v_item_cost * (v_item->>'quantity')::int);
  END LOOP;

  v_total_price := GREATEST(0, v_subtotal - p_discount_amount - p_bonus_used + p_delivery_fee);
  v_cashback_earned := ROUND(GREATEST(0, v_total_price - p_delivery_fee) * v_cashback_rate, 0);

  UPDATE profiles SET bonus_balance = bonus_balance - p_bonus_used, pending_bonus = pending_bonus + v_cashback_earned WHERE id = p_user_id;

  INSERT INTO orders (
    user_id, order_type, table_number, is_addon_order, delivery_address,
    comment, payment_method, status, subtotal, discount_amount, bonus_used,
    delivery_fee, total_price, cogs_total, cashback_earned
  ) VALUES (
    p_user_id, p_order_type, p_table_number, p_is_addon_order, p_delivery_address,
    p_comment, p_payment_method, 'new', v_subtotal, p_discount_amount, p_bonus_used,
    p_delivery_fee, v_total_price, v_cogs_total, v_cashback_earned
  ) RETURNING id INTO v_order_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    SELECT * INTO v_menu_item FROM menu_items WHERE id = (v_item->>'menu_item_id')::uuid;
    SELECT COALESCE(SUM(r.qty_required * i.avg_cost), 0) INTO v_item_cost
    FROM recipes r JOIN ingredients i ON i.id = r.ingredient_id WHERE r.menu_item_id = v_menu_item.id;

    INSERT INTO order_items (
      order_id, menu_item_id, item_title_snapshot, quantity,
      price_at_moment, cost_at_moment, selected_modifiers
    ) VALUES (
      v_order_id, v_menu_item.id, v_menu_item.title, (v_item->>'quantity')::int,
      v_menu_item.price, v_item_cost, COALESCE(v_item->'selected_modifiers', '[]'::jsonb)
    );
  END LOOP;

  SELECT to_jsonb(o.*) INTO v_result FROM orders o WHERE o.id = v_order_id;
  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION complete_order(p_order_id int) RETURNS void AS $$
DECLARE
  v_order record;
  v_new_spent numeric;
  v_new_tier text;
  v_payment_source text;
BEGIN
  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Заказ #% не найден', p_order_id; END IF;
  IF v_order.status = 'completed' THEN RETURN; END IF;

  UPDATE orders SET status = 'completed' WHERE id = p_order_id;

  IF v_order.user_id IS NOT NULL THEN
    UPDATE profiles
    SET pending_bonus = GREATEST(0, pending_bonus - v_order.cashback_earned),
        bonus_balance = bonus_balance + v_order.cashback_earned,
        total_spent = total_spent + v_order.total_price
    WHERE id = v_order.user_id
    RETURNING total_spent INTO v_new_spent;

    v_new_tier := CASE WHEN v_new_spent >= 50000 THEN 'gold' WHEN v_new_spent >= 15000 THEN 'silver' ELSE 'bronze' END;
    UPDATE profiles SET loyalty_tier = v_new_tier WHERE id = v_order.user_id;
  END IF;

  UPDATE ingredients i
  SET stock_qty = GREATEST(0, i.stock_qty - sub.total_deduct)
  FROM (
    SELECT r.ingredient_id, SUM(r.qty_required * oi.quantity) AS total_deduct
    FROM order_items oi JOIN recipes r ON r.menu_item_id = oi.menu_item_id
    WHERE oi.order_id = p_order_id GROUP BY r.ingredient_id
  ) sub WHERE i.id = sub.ingredient_id;

  v_payment_source := CASE WHEN v_order.payment_method = 'cash' THEN 'cash_register' ELSE 'bank_account' END;

  INSERT INTO accounting_transactions (type, category, amount, payment_source, order_id, description)
  VALUES ('income', 'Выручка от заказов', v_order.total_price, v_payment_source, p_order_id, 'Оплата заказа #' || p_order_id || ' (' || v_order.order_type || ')');

  UPDATE cash_shifts
  SET expected_cash = expected_cash + CASE WHEN v_order.payment_method = 'cash' THEN v_order.total_price ELSE 0 END,
      total_card = total_card + CASE WHEN v_order.payment_method = 'card_pos' THEN v_order.total_price ELSE 0 END,
      total_online = total_online + CASE WHEN v_order.payment_method = 'online' THEN v_order.total_price ELSE 0 END
  WHERE status = 'open';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION cancel_order_with_audit(p_order_id int, p_reason text, p_actor text) RETURNS void AS $$
DECLARE
  v_order record;
BEGIN
  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Заказ #% не найден', p_order_id; END IF;
  IF v_order.status = 'cancelled' THEN RETURN; END IF;

  UPDATE orders SET status = 'cancelled', cancel_reason = p_reason WHERE id = p_order_id;

  IF v_order.user_id IS NOT NULL THEN
    UPDATE profiles
    SET bonus_balance = bonus_balance + v_order.bonus_used,
        pending_bonus = GREATEST(0, pending_bonus - v_order.cashback_earned)
    WHERE id = v_order.user_id;
  END IF;

  IF p_reason = 'Брак кухни' THEN
    UPDATE ingredients i
    SET stock_qty = GREATEST(0, i.stock_qty - sub.total_deduct)
    FROM (
      SELECT r.ingredient_id, SUM(r.qty_required * oi.quantity) AS total_deduct
      FROM order_items oi JOIN recipes r ON r.menu_item_id = oi.menu_item_id
      WHERE oi.order_id = p_order_id GROUP BY r.ingredient_id
    ) sub WHERE i.id = sub.ingredient_id;
  END IF;

  INSERT INTO audit_logs (actor_name, action, details)
  VALUES (p_actor, 'ОТМЕНА ЗАКАЗА #' || p_order_id, 'Причина: ' || p_reason || '. Сумма: ' || v_order.total_price || ' ₸');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

ALTER PUBLICATION supabase_realtime ADD TABLE
  orders, order_items, menu_items, service_requests, accounting_transactions, ingredients;

DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'profiles','menu_items','ingredients','recipes','promocodes','orders',
    'order_items','reservations','service_requests','reviews','cash_shifts',
    'accounting_transactions','staff_members','suppliers','scheduled_payments','audit_logs'
  ]) LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('DROP POLICY IF EXISTS "allow_all_%I" ON %I;', t, t);
    EXECUTE format('CREATE POLICY "allow_all_%I" ON %I FOR ALL USING (true) WITH CHECK (true);', t, t);
  END LOOP;
END $$;

INSERT INTO profiles (id, name, phone, role, bonus_balance, total_spent, loyalty_tier) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Алишер Каримов (Гость)', '+7 701 555 01 01', 'client', 1200, 18500, 'silver'),
  ('22222222-2222-2222-2222-222222222222', 'Тимур (Шеф-повар)', '+7 701 555 02 02', 'cook', 0, 0, 'bronze'),
  ('33333333-3333-3333-3333-333333333333', 'Айгерим (Официант)', '+7 701 555 03 03', 'waiter', 0, 0, 'bronze'),
  ('44444444-4444-4444-4444-444444444444', 'Данияр (Курьер)', '+7 701 555 04 04', 'courier', 0, 0, 'bronze'),
  ('55555555-5555-5555-5555-555555555555', 'Гульнара (Бухгалтер)', '+7 701 555 05 05', 'accountant', 0, 0, 'bronze')
ON CONFLICT (id) DO NOTHING;

INSERT INTO ingredients (id, name, unit, stock_qty, avg_cost, min_threshold) VALUES
  ('a0000001-0000-0000-0000-000000000001', 'Баранина (мякоть)', 'кг', 28.5, 4200, 10),
  ('a0000002-0000-0000-0000-000000000002', 'Говядина вырезка', 'кг', 34.0, 3800, 10),
  ('a0000003-0000-0000-0000-000000000003', 'Рис Лазер', 'кг', 55.0, 950, 15),
  ('a0000004-0000-0000-0000-000000000004', 'Морковь желтая', 'кг', 40.0, 320, 10),
  ('a0000005-0000-0000-0000-000000000005', 'Мука в/с', 'кг', 60.0, 280, 15),
  ('a0000006-0000-0000-0000-000000000006', 'Помидоры ташкентские', 'кг', 18.0, 1100, 5),
  ('a0000007-0000-0000-0000-000000000007', 'Масло хлопковое', 'л', 22.0, 1200, 5),
  ('a0000008-0000-0000-0000-000000000008', 'Чай черный листовой + чабрец', 'кг', 6.5, 6500, 2)
ON CONFLICT (id) DO NOTHING;

INSERT INTO menu_items (id, title, description, category, price, weight, image_url, is_popular, is_spicy, in_stock, station, modifiers) VALUES
  ('b0000001-0000-0000-0000-000000000001', 'Плов Самаркандский', 'Рассыпчатый рис Лазер, томленая баранина, желтая морковь, нут и зира', 'Горячее', 3200, '380 г', 'https://images.unsplash.com/photo-1633945274405-b6c8069047b0?w=500', true, false, true, 'hot_kitchen', '["Двойное мясо (+700₸)", "Казы (+600₸)", "Перепелиное яйцо"]'::jsonb),
  ('b0000002-0000-0000-0000-000000000002', 'Шашлык из баранины', 'Сочные кусочки мякоти на углях с маринованным луком и томатным соусом', 'Мангал', 2900, '220 г', 'https://images.unsplash.com/photo-1555939594-58d7cb561ad1?w=500', true, false, true, 'hot_kitchen', '["Прожарка Medium", "Прожарка Well Done", "Острый соус"]'::jsonb),
  ('b0000003-0000-0000-0000-000000000003', 'Лагман Уйгурский', 'Тянутая вручную лапша с обжаренной говядиной, перцем и ароматным бульоном', 'Супы', 2700, '420 г', 'https://images.unsplash.com/photo-1569718212165-3a8278d5f624?w=500', true, true, true, 'hot_kitchen', '["Без острого", "Добавить лазджан", "Двойная лапша"]'::jsonb),
  ('b0000004-0000-0000-0000-000000000004', 'Манты с рубленой говядиной', '5 крупных мантов на пару с сочной рубленой говядиной и луком', 'Горячее', 2600, '350 г', 'https://images.unsplash.com/photo-1496116218417-1a781b1c416c?w=500', true, false, true, 'hot_kitchen', '["Со сметаной", "С острым соусом", "Жареные"]'::jsonb),
  ('b0000005-0000-0000-0000-000000000005', 'Самса тандырная с бараниной', 'Хрустящее слоеное тесто из тандыра с рубленой бараниной и курдюком', 'Выпечка', 950, '160 г', 'https://images.unsplash.com/photo-1601050690597-df0568f70950?w=500', true, false, true, 'hot_kitchen', '["С томатным соусом", "Подогреть сильнее"]'::jsonb),
  ('b0000006-0000-0000-0000-000000000006', 'Шурпа по-бухарски', 'Наваристый бульон с бараниной на кости, нутом, картофелем и зеленью', 'Супы', 2500, '400 г', 'https://images.unsplash.com/photo-1547592166-23ac45744acd?w=500', false, false, true, 'hot_kitchen', '["Без кинзы", "Добавить острый перец"]'::jsonb),
  ('b0000007-0000-0000-0000-000000000007', 'Казан-кебаб', 'Обжаренные ребрышки баранины с золотистым молодым картофелем', 'Горячее', 3900, '400 г', 'https://images.unsplash.com/photo-1544025162-d76694265947?w=500', true, false, true, 'hot_kitchen', '["Соус гранатовый", "Дополнительный лук"]'::jsonb),
  ('b0000008-0000-0000-0000-000000000008', 'Чучвара в бульоне', 'Миниатюрные восточные пельмени ручной лепки в прозрачном бульоне', 'Супы', 2300, '350 г', 'https://images.unsplash.com/photo-1583032015879-e5022cb87c3b?w=500', false, false, true, 'hot_kitchen', '["Со сметаной", "Без зелени"]'::jsonb),
  ('b0000009-0000-0000-0000-000000000009', 'Люля-кебаб из говядины', 'Нежный рубленый кебаб со специями на тонком лаваше', 'Мангал', 2400, '200 г', 'https://images.unsplash.com/photo-1529193591184-b1d58069ecdd?w=500', false, false, true, 'hot_kitchen', '["Острый соус", "Соус тартар"]'::jsonb),
  ('b0000010-0000-0000-0000-000000000010', 'Салат Ачичук', 'Спелые ташкентские томаты, тонкий красный лук, базилик и стручковый перец', 'Салаты', 1400, '220 г', 'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=500', true, true, true, 'cold_bar', '["Без острого перца", "Без лука"]'::jsonb),
  ('b0000011-0000-0000-0000-000000000011', 'Лепешка Самаркандская', 'Пышная горячая лепешка из тандыра с кунжутом', 'Выпечка', 600, '250 г', 'https://images.unsplash.com/photo-1509440159596-0249088772ff?w=500', false, false, true, 'hot_kitchen', '["Разрезать на 4 части"]'::jsonb),
  ('b0000012-0000-0000-0000-000000000012', 'Восточная пахлава с фисташкой', 'Медовая слоеная пахлава с дробленной фисташкой и грецким орехом', 'Десерты', 1600, '140 г', 'https://images.unsplash.com/photo-1519676867240-f03562e64548?w=500', false, false, true, 'cold_bar', '["Подать с шариком мороженого"]'::jsonb),
  ('b0000013-0000-0000-0000-000000000013', 'Чай «Шелковый путь» (чайник)', 'Черный листовой чай с горным чабрецом, лимоном и наватом', 'Напитки', 1500, '800 мл', 'https://images.unsplash.com/photo-1544787219-7f47ccb76574?w=500', true, false, true, 'cold_bar', '["Сахар отдельно", "Без чабреца"]'::jsonb),
  ('b0000014-0000-0000-0000-000000000014', 'Айран домашний с зеленью', 'Освежающий кисломолочный напиток с укропом и огурцом', 'Напитки', 900, '350 мл', 'https://images.unsplash.com/photo-1556679343-c7306c1976bc?w=500', false, false, true, 'cold_bar', '["Со льдом", "Без зелени"]'::jsonb)
ON CONFLICT (id) DO NOTHING;

INSERT INTO recipes (menu_item_id, ingredient_id, qty_required) VALUES
  ('b0000001-0000-0000-0000-000000000001', 'a0000001-0000-0000-0000-000000000001', 0.15),
  ('b0000001-0000-0000-0000-000000000001', 'a0000003-0000-0000-0000-000000000003', 0.14),
  ('b0000001-0000-0000-0000-000000000001', 'a0000004-0000-0000-0000-000000000004', 0.12),
  ('b0000001-0000-0000-0000-000000000001', 'a0000007-0000-0000-0000-000000000007', 0.05),
  ('b0000002-0000-0000-0000-000000000002', 'a0000001-0000-0000-0000-000000000001', 0.24),
  ('b0000003-0000-0000-0000-000000000003', 'a0000002-0000-0000-0000-000000000002', 0.14),
  ('b0000003-0000-0000-0000-000000000003', 'a0000005-0000-0000-0000-000000000005', 0.12),
  ('b0000004-0000-0000-0000-000000000004', 'a0000002-0000-0000-0000-000000000002', 0.18),
  ('b0000004-0000-0000-0000-000000000004', 'a0000005-0000-0000-0000-000000000005', 0.10),
  ('b0000010-0000-0000-0000-000000000010', 'a0000006-0000-0000-0000-000000000006', 0.22),
  ('b0000013-0000-0000-0000-000000000013', 'a0000008-0000-0000-0000-000000000008', 0.02);

INSERT INTO promocodes (code, discount_type, discount_value, is_active) VALUES
  ('PLOV10', 'percent', 10, true),
  ('SAMARKAND', 'fixed', 1000, true),
  ('VIP20', 'percent', 20, true)
ON CONFLICT (code) DO NOTHING;

INSERT INTO suppliers (name, category, debt_amount) VALUES
  ('ТОО «Восток-Мясо»', 'Мясо и птица', 185000),
  ('ИП «Ташкент-Базар»', 'Овощи, специи, рис', 64000),
  ('ТОО «Азия-Напитки»', 'Чай и напитки', 32000);

INSERT INTO staff_members (name, position, shift_rate, sales_percent, shifts_worked, advances_paid, tips_earned) VALUES
  ('Тимур Рахимов', 'Шеф-повар', 18000, 1.5, 12, 50000, 0),
  ('Айгерим Серикова', 'Старший официант', 9000, 3.0, 14, 30000, 24500),
  ('Данияр Болатов', 'Курьер', 8000, 2.0, 10, 20000, 11000);

INSERT INTO scheduled_payments (title, category, amount, due_date, is_paid) VALUES
  ('Аренда помещения (основной зал)', 'Аренда', 850000, CURRENT_DATE + 5, false),
  ('Электроэнергия и газ (тандыр)', 'Коммунальные', 145000, CURRENT_DATE + 8, false),
  ('Таргетированная реклама Instagram', 'Маркетинг', 90000, CURRENT_DATE + 2, false);

INSERT INTO cash_shifts (status, opening_cash, expected_cash, total_card, total_online)
VALUES ('open', 50000, 50000, 0, 0);
