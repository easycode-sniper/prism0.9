-- ━─ Enable extensions ━─────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS postgis;

-- ━─ Profiles (extends Supabase Auth) ━─────────────────
-- One row per authenticated user. Created automatically
-- by the on_auth_user_created trigger.
CREATE TABLE IF NOT EXISTS public.profiles (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email       TEXT    NOT NULL,
  full_name   TEXT,
  role        TEXT    NOT NULL DEFAULT 'operator'
    CHECK (role IN ('operator', 'admin')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Profiles viewable by authenticated users"
  ON public.profiles FOR SELECT TO authenticated USING (true);

CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile"
  ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);

-- Auto-create profile row when a new user signs up
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    'operator'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ━─ Fleet trucks ━──────────────────────────────────────
-- Registry of all 84 trucks. Replaces the hardcoded
-- fleetTrucks array from the original app.
CREATE TABLE IF NOT EXISTS public.fleet_trucks (
  id              SERIAL PRIMARY KEY,
  truck_id        TEXT    NOT NULL UNIQUE,         -- e.g. "000051-525-35"
  name            TEXT,
  wialon_unit_name TEXT,
  status          TEXT    NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive', 'maintenance')),
  created_by      UUID    REFERENCES public.profiles(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.fleet_trucks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Fleet trucks viewable by authenticated users"
  ON public.fleet_trucks FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins can manage fleet trucks"
  ON public.fleet_trucks FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles
                 WHERE id = auth.uid() AND role = 'admin'));

-- ━─ Construction sites ━────────────────────────────────
-- Registry of all 125 sites / destinations. Replaces the
-- hardcoded constructionSites array from the original app.
CREATE TABLE IF NOT EXISTS public.construction_sites (
  id              UUID    PRIMARY KEY DEFAULT uuid_generate_v4(),
  site_code       TEXT    NOT NULL,
  name            TEXT    NOT NULL,
  client          TEXT,
  lat             DOUBLE PRECISION,
  lng             DOUBLE PRECISION,
  accuracy        TEXT    NOT NULL DEFAULT 'exact'
    CHECK (accuracy IN ('exact', 'town', 'approx')),
  accuracy_note   TEXT,
  is_duplicate_suspect BOOLEAN NOT NULL DEFAULT FALSE,
  is_manual       BOOLEAN NOT NULL DEFAULT FALSE,
  created_by      UUID    REFERENCES public.profiles(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.construction_sites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Construction sites viewable by authenticated users"
  ON public.construction_sites FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins can manage construction sites"
  ON public.construction_sites FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles
                 WHERE id = auth.uid() AND role = 'admin'));

CREATE INDEX IF NOT EXISTS idx_construction_sites_client
  ON public.construction_sites (client);

CREATE INDEX IF NOT EXISTS idx_construction_sites_name
  ON public.construction_sites (name);

-- ━─ Geofences ━─────────────────────────────────────────
-- Factory zone, PARC OMD circle, and uploaded KML zones.
-- Uses PostGIS geometry for polygons (spatial queries).
CREATE TABLE IF NOT EXISTS public.geofences (
  id              UUID    PRIMARY KEY DEFAULT uuid_generate_v4(),
  name            TEXT    NOT NULL,
  kind            TEXT    NOT NULL CHECK (kind IN ('factory', 'site')),
  polygon         GEOMETRY(Polygon, 4326),   -- PostGIS; NULL for circle geofences
  center_lat      DOUBLE PRECISION,
  center_lng      DOUBLE PRECISION,
  radius_meters   INTEGER,
  site_id         UUID    REFERENCES public.construction_sites(id),
  created_by      UUID    REFERENCES public.profiles(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.geofences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Geofences viewable by authenticated users"
  ON public.geofences FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins can manage geofences"
  ON public.geofences FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles
                 WHERE id = auth.uid() AND role = 'admin'));

CREATE INDEX IF NOT EXISTS idx_geofences_site_id
  ON public.geofences (site_id);

CREATE INDEX IF NOT EXISTS idx_geofences_kind
  ON public.geofences (kind);

CREATE INDEX IF NOT EXISTS idx_geofences_polygon
  ON public.geofences USING GIST (polygon);

-- ━─ Dispatches (core persistent state) ━───────────────
-- Every run — active, completed, or stopped — is a row.
-- This is the table that makes multi-user work.
CREATE TABLE IF NOT EXISTS public.dispatches (
  id                        UUID    PRIMARY KEY DEFAULT uuid_generate_v4(),
  truck_id                  TEXT    NOT NULL,
  site_id                   UUID    REFERENCES public.construction_sites(id),
  dispatched_by             UUID    NOT NULL REFERENCES public.profiles(id),
  dispatched_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Position tracking
  last_lat                  DOUBLE PRECISION,
  last_lng                  DOUBLE PRECISION,
  last_checked_at           TIMESTAMPTZ,
  last_deviation_meters     DOUBLE PRECISION,
  last_on_route             BOOLEAN,
  last_deviation_basis      TEXT    CHECK (last_deviation_basis IN ('route', 'straight')),
  last_eta_seconds          INTEGER,
  last_eta_basis            TEXT    CHECK (last_eta_basis IN ('osrm-speed', 'fallback-speed')),
  -- Route geometry (cached from OSRM as [[lat,lng], ...])
  route_geometry            JSONB,
  route_total_distance_meters DOUBLE PRECISION,
  route_total_time_seconds  DOUBLE PRECISION,
  -- Arrival tracking
  site_arrival_notified     BOOLEAN NOT NULL DEFAULT FALSE,
  factory_arrival_notified  BOOLEAN NOT NULL DEFAULT FALSE,
  arrived_at                TIMESTAMPTZ,
  -- Alert tracking (never reset — for history/reporting)
  ever_off_route            BOOLEAN NOT NULL DEFAULT FALSE,
  ever_speeding             BOOLEAN NOT NULL DEFAULT FALSE,
  -- Stop tracking
  stopped_at                TIMESTAMPTZ,
  stopped_by                UUID    REFERENCES public.profiles(id),
  -- Status
  status                    TEXT    NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'completed', 'stopped')),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Convenience: driver name snapshot at time of dispatch
  driver_name               TEXT
);

ALTER TABLE public.dispatches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Dispatches viewable by authenticated users"
  ON public.dispatches FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can create dispatches"
  ON public.dispatches FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = dispatched_by);

CREATE POLICY "Users can update own dispatches, admins can update all"
  ON public.dispatches FOR UPDATE TO authenticated
  USING (auth.uid() = dispatched_by
      OR EXISTS (SELECT 1 FROM public.profiles
                 WHERE id = auth.uid() AND role = 'admin'));

-- Note: DELETE is not allowed — stopping a dispatch is done via
-- UPDATE (setting status = 'stopped', stopped_at, stopped_by).
-- Historical dispatches are never deleted.

CREATE INDEX IF NOT EXISTS idx_dispatches_truck_id
  ON public.dispatches (truck_id);

CREATE INDEX IF NOT EXISTS idx_dispatches_site_id
  ON public.dispatches (site_id);

CREATE INDEX IF NOT EXISTS idx_dispatches_dispatched_by
  ON public.dispatches (dispatched_by);

CREATE INDEX IF NOT EXISTS idx_dispatches_status_dispatch_at
  ON public.dispatches (status, dispatched_at DESC);

CREATE INDEX IF NOT EXISTS idx_dispatches_stopped_at
  ON public.dispatches (stopped_at);

-- ━─ Notifications ━─────────────────────────────────────
-- Persisted alert log: off_route, speeding, site_arrival,
-- factory_arrival. Survives browser close.
CREATE TABLE IF NOT EXISTS public.notifications (
  id            UUID    PRIMARY KEY DEFAULT uuid_generate_v4(),
  dispatch_id   UUID    REFERENCES public.dispatches(id) ON DELETE SET NULL,
  truck_id      TEXT    NOT NULL,
  kind          TEXT    NOT NULL CHECK (kind IN
    ('off_route', 'speeding', 'site_arrival', 'factory_arrival')),
  title         TEXT    NOT NULL,
  message       TEXT    NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  read          BOOLEAN NOT NULL DEFAULT FALSE
);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Notifications viewable by authenticated users"
  ON public.notifications FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can create notifications"
  ON public.notifications FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Dispatcher or admin can mark notifications read"
  ON public.notifications FOR UPDATE TO authenticated
  USING (
    auth.uid() = (SELECT dispatched_by
                  FROM public.dispatches
                  WHERE id = notifications.dispatch_id)
    OR EXISTS (SELECT 1 FROM public.profiles
               WHERE id = auth.uid() AND role = 'admin')
  );

CREATE INDEX IF NOT EXISTS idx_notifications_dispatch_id
  ON public.notifications (dispatch_id);

CREATE INDEX IF NOT EXISTS idx_notifications_truck_id
  ON public.notifications (truck_id);

CREATE INDEX IF NOT EXISTS idx_notifications_kind
  ON public.notifications (kind);

CREATE INDEX IF NOT EXISTS idx_notifications_created_at
  ON public.notifications (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_read
  ON public.notifications (read);

-- ━─ Wialon unit mappings ━──────────────────────────────
-- Caches the resolved Wialon unit name for each truck.
-- One row per truck. Admin-maintained.
CREATE TABLE IF NOT EXISTS public.wialon_unit_mappings (
  id              UUID    PRIMARY KEY DEFAULT uuid_generate_v4(),
  truck_id        TEXT    NOT NULL REFERENCES public.fleet_trucks(truck_id),
  wialon_unit_name TEXT  NOT NULL,
  resolved_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (truck_id)
);

ALTER TABLE public.wialon_unit_mappings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Wialon mappings viewable by authenticated users"
  ON public.wialon_unit_mappings FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins can manage Wialon mappings"
  ON public.wialon_unit_mappings FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles
                 WHERE id = auth.uid() AND role = 'admin'));

-- ━─ App config ━─────────────────────────────────────────
-- Stores the Wialon relay URL + server. Admin sets once;
-- all users use the same connection configuration.
CREATE TABLE IF NOT EXISTS public.app_config (
  id              UUID    PRIMARY KEY DEFAULT uuid_generate_v4(),
  config_key      TEXT    NOT NULL UNIQUE,
  config_value    JSONB   NOT NULL,
  updated_by      UUID    REFERENCES public.profiles(id),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "App config viewable by authenticated users"
  ON public.app_config FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins can manage app config"
  ON public.app_config FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles
                 WHERE id = auth.uid() AND role = 'admin'));

-- ━─ User settings (optional) ━──────────────────────────
-- Per-user UI preferences: theme and language. Not in the
-- original app, but a small convenience. Can be removed if
-- you prefer session-only preferences.
CREATE TABLE IF NOT EXISTS public.user_settings (
  id          UUID    PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID    NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  theme       TEXT    NOT NULL DEFAULT 'dark'
    CHECK (theme IN ('dark', 'light', 'black')),
  language    TEXT    NOT NULL DEFAULT 'en'
    CHECK (language IN ('en', 'fr', 'ar')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id)
);

ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own settings"
  ON public.user_settings FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own settings"
  ON public.user_settings FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own settings"
  ON public.user_settings FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);

-- ━─ Foreign key: dispatches → fleet_trucks ━────────────
-- Ensures every dispatch references a known truck.
ALTER TABLE public.dispatches
  ADD CONSTRAINT fk_dispatch_truck
  FOREIGN KEY (truck_id) REFERENCES public.fleet_trucks(truck_id);

-- ━───────────────────────────────────────────────────────
-- SEED DATA (commented out by default)
-- ━─ Uncomment and run ONCE to populate initial data ────
-- ━───────────────────────────────────────────────────────

-- ── Set the admin user ID (replace with your actual UID) ──
-- SET @admin_user_id = 'YOUR_ADMIN_USER_UUID_HERE';

-- ── 84 fleet trucks ──
-- INSERT INTO public.fleet_trucks (truck_id, status, created_by) VALUES
--   ('000051-525-35', 'active', @admin_user_id),
--   ('000052-525-35', 'active', @admin_user_id),
--   ... (all 84 trucks)
-- ;

-- ── 125 construction sites ──
-- INSERT INTO public.construction_sites
--   (site_code, name, client, lat, lng, accuracy, is_duplicate_suspect, created_by) VALUES
--   ('site_0', 'Usine Amouda Ciment, C3P5+PFC, El Baida Ciment', 'AMOUDA', 34.4368063, 2.058655, 'exact', false, @admin_user_id),
--   ('site_1', 'A81 ADRAR', 'SPA COSIDER OUVRAGE D''ART - A81 -', 28.004197, -0.271312, 'exact', false, @admin_user_id),
--   ... (all 125 sites)
-- ;

-- ── 2 geofences ──
-- -- Factory polygon (indigo)
-- INSERT INTO public.geofences (name, kind, polygon, created_by)
--   VALUES (
--     'Zone d''attente – Usine AMOUDA Ciment',
--     'factory',
--     ST_SetSRID(ST_GeomFromText('POLYGON((2.0633263065 34.4505353635, 2.0456678955 34.4382014323, 2.0600874511 34.4253878741, 2.078475423 34.437511332, 2.0633263065 34.4505353635))'), 4326),
--     @admin_user_id
--   );
-- -- PARC OMD circle (green, 150m radius)
-- INSERT INTO public.geofences (name, kind, center_lat, center_lng, radius_meters, created_by)
--   VALUES (
--     'PARC OMD - Headquarters & Parking',
--     'site',
--     36.6416533,
--     3.2922333,
--     150,
--     @admin_user_id
--   );

-- ── App config (Wialon) ──
-- INSERT INTO public.app_config (config_key, config_value, updated_by)
--   VALUES (
--     'wialon',
--     '{"relay": "https://wialon-relay1.ferdjellahsouhaibomd.workers.dev", "server": "hst-api.wialon.eu"}',
--     @admin_user_id
--   )
--   ON CONFLICT (config_key) DO NOTHING;

-- ━─ End of migration ━───────────────────────────────────
