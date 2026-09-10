-- Minimal stand-ins for the tables migration 060 touches. Column names
-- and types copied from the real migrations so the function bodies bind
-- against the same shapes production has.

CREATE TABLE public.fuel_transactions (
  transaction_no   TEXT PRIMARY KEY,
  truck_id         TEXT,
  category         TEXT NOT NULL DEFAULT 'truck',
  driver_name      TEXT,
  occurred_at      TIMESTAMPTZ NOT NULL,
  station          TEXT,
  amount_da        NUMERIC NOT NULL,
  distance_km      NUMERIC,
  litres_filled    NUMERIC,
  variance_da      NUMERIC,
  occurred_raw     TEXT,
  sheet_row        INTEGER
);

CREATE TABLE public.zone_visits (
  id          BIGSERIAL PRIMARY KEY,
  truck_id    TEXT NOT NULL,
  driver_name TEXT,
  zone_kind   TEXT NOT NULL,
  zone_name   TEXT NOT NULL,
  entered_at  TIMESTAMPTZ NOT NULL,
  exited_at   TIMESTAMPTZ
);

CREATE TABLE public.dispatches (
  id          BIGSERIAL PRIMARY KEY,
  truck_id    TEXT,
  driver_name TEXT
);

CREATE TABLE public.notifications (
  id          BIGSERIAL PRIMARY KEY,
  kind        TEXT NOT NULL,
  truck_id    TEXT,
  dispatch_id BIGINT REFERENCES public.dispatches(id),
  created_at  TIMESTAMPTZ NOT NULL
);

CREATE TABLE public.fleet_trucks (
  truck_id TEXT PRIMARY KEY,
  category TEXT
);

CREATE TABLE public.fleet_day_metrics (
  ops_day        DATE PRIMARY KEY,
  km             NUMERIC NOT NULL DEFAULT 0,
  vehicles_moved INT NOT NULL DEFAULT 0
);

-- ── Data ──────────────────────────────────────────────────────────────
-- Two trucks and three drivers, on two days, with the name spellings
-- that actually occur: the fuel sheet and the tracker disagree on case,
-- on accents, on token order, and in one case on the letters themselves.

INSERT INTO public.fleet_trucks VALUES ('T-100', 'truck'), ('T-200', 'truck'), ('S-900', 'staff');

-- Fuel sheet spellings.
INSERT INTO public.fuel_transactions
  (transaction_no, truck_id, driver_name, occurred_at, station, amount_da, distance_km, litres_filled, variance_da, occurred_raw, sheet_row) VALUES
  -- T-100 / HALLA Abderrezak — two paired fills
  ('f1', 'T-100', 'HALLA Abderrezak',  '2026-09-01T09:00:00+01', 'NAFTAL A', 31000, 1000, 500, 1000, '01/09/2026 09:00', 1),
  ('f2', 'T-100', 'HALLA Abderrezak',  '2026-09-02T09:00:00+01', 'NAFTAL A', 15500,  500, 250,  500, '02/09/2026 09:00', 2),
  -- T-200 / accents + reversed token order vs the tracker
  ('f3', 'T-200', 'AMIR SMARA',        '2026-09-01T10:00:00+01', 'NAFTAL B', 62000, 2000, 1000, 2000, '01/09/2026 10:00', 3),
  -- an UNPAIRED fill (no variance): counts to totals, never to the rate
  ('f4', 'T-200', 'AMIR SMARA',        '2026-09-02T10:00:00+01', 'NAFTAL B',  5000, NULL,  100, NULL, '02/09/2026 10:00', 4),
  -- a driver the sheet MISSPELLS relative to the tracker: must NOT match
  ('f5', 'T-100', 'Zakraoui abdelkader','2026-09-02T11:00:00+01','NAFTAL A', 10000,  200, 100,  200, '02/09/2026 11:00', 5);

-- Tracker spellings (Wialon side) — deliberately different.
INSERT INTO public.zone_visits (truck_id, driver_name, zone_kind, zone_name, entered_at, exited_at) VALUES
  -- qualifying deliveries (>= 1500s)
  ('T-100', 'HALLA ABDERREZAK', 'site',    'SITE A', '2026-09-01T12:00:00+01', '2026-09-01T13:00:00+01'),
  ('T-100', 'halla abderrezak', 'site',    'SITE B', '2026-09-02T12:00:00+01', '2026-09-02T13:00:00+01'),
  -- token order reversed vs the sheet's "AMIR SMARA"
  ('T-200', 'SMARA Amir',       'site',    'SITE C', '2026-09-01T14:00:00+01', '2026-09-01T15:00:00+01'),
  -- too short to count as a delivery
  ('T-200', 'SMARA Amir',       'site',    'SITE D', '2026-09-02T14:00:00+01', '2026-09-02T14:10:00+01'),
  -- the factory, never a delivery
  ('T-100', 'HALLA ABDERREZAK', 'factory', 'AMOUDA', '2026-09-01T08:00:00+01', '2026-09-01T09:00:00+01'),
  -- the tracker's spelling of the misspelled driver
  ('T-100', 'ZEKRAOUI Abdelkader','site',  'SITE E', '2026-09-02T16:00:00+01', '2026-09-02T17:00:00+01');

INSERT INTO public.dispatches (id, truck_id, driver_name) VALUES
  (1, 'T-100', 'HALLA Abderrezak'),
  (2, 'T-200', 'SMARA Amir');

INSERT INTO public.notifications (kind, truck_id, dispatch_id, created_at) VALUES
  ('speeding',  'T-100', 1, '2026-09-01T09:30:00+01'),
  ('speeding',  'T-100', 1, '2026-09-02T09:30:00+01'),
  ('speeding',  'T-200', 2, '2026-09-01T11:00:00+01'),
  ('off_route', 'T-100', 1, '2026-09-01T09:45:00+01'),
  -- a staff vehicle: excluded from the speeding panel by 038
  ('speeding',  'S-900', NULL, '2026-09-01T09:50:00+01');

INSERT INTO public.fleet_day_metrics (ops_day, km, vehicles_moved) VALUES
  ('2026-09-01', 9999, 40),
  ('2026-09-02', 8888, 38);
