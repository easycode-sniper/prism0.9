-- ━─ Separate staff cars from cargo trucks ━────────────────
-- Nine of the tracked units are staff cars, not delivery trucks. They
-- come and go from HQ all day, so they dominated the notification feed
-- with arrivals nobody needs to act on.
--
-- Classified explicitly per vehicle rather than by an ID pattern. The
-- staff IDs do look distinct — every real truck has a 519/522/523/525
-- middle segment, and every staff car is in the 113–324 range — but
-- 00031-115-35 is a real cargo truck sitting inside that "staff-looking"
-- range, confirmed with the operator. A regex would have silently muted
-- it, and a truck that stops alerting is a failure nobody notices. Nine
-- rows of explicit data beat a clever rule that is wrong once.

ALTER TABLE public.fleet_trucks
  ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'truck'
    CHECK (category IN ('truck', 'staff'));

-- Upsert, not update: fleet_trucks only holds rows for units the app has
-- already seen, so some of these may not exist yet.
INSERT INTO public.fleet_trucks (truck_id, category) VALUES
  ('00792-324-35',  'staff'),
  ('000966-320-35', 'staff'),
  ('01171-115-35',  'staff'),
  ('02316-315-35',  'staff'),
  ('03144-118-35',  'staff'),
  ('07762-113-35',  'staff'),
  ('037286-117-16', 'staff'),
  ('119704-118-16', 'staff'),
  ('191322-114-16', 'staff')
ON CONFLICT (truck_id) DO UPDATE
  SET category = EXCLUDED.category, updated_at = NOW();

-- Belt and braces: 00031-115-35 is a real truck despite its ID, so make
-- that explicit rather than relying on the column default.
INSERT INTO public.fleet_trucks (truck_id, category) VALUES ('00031-115-35', 'truck')
ON CONFLICT (truck_id) DO UPDATE
  SET category = EXCLUDED.category, updated_at = NOW();
