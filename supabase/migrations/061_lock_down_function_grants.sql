-- ━─ Close the unauthenticated write hole, and tidy the rest ━──────────
--
-- FOUND IN A PRE-SHIP AUDIT, 2026-09-14. Two SECURITY DEFINER functions
-- were executable by `anon` — that is, by anybody on the internet, with
-- no account, using the publishable key that ships in the browser
-- bundle by design:
--
--   public.mark_trucks_speeding_state(text[], boolean)
--   public.mark_trucks_station_state(text[], uuid)
--
-- SECURITY DEFINER means they bypass RLS. Both are upserts into
-- fleet_trucks, and both RETURN ONLY THE ROWS WHOSE FLAG CHANGED —
-- which is precisely the transition signal the alerting keys on. So an
-- unauthenticated caller could:
--
--   * insert arbitrary fleet_trucks rows (PROVEN in the audit: calling
--     with a truck id that does not exist created one);
--   * flip is_speeding on a real truck, fabricating a speeding alert or,
--     by pre-setting the flag, making a genuine one raise nothing;
--   * flip at_blacklisted_station_id, which is the one alert that also
--     SENDS EMAIL to the fuel desk — so either forge a fuel-theft alert
--     or silence a real one.
--
-- The table layer was never the problem and is not being changed: RLS
-- held throughout. Verified during the audit that `anon` reads zero rows
-- from fleet_trucks, driver_directory and app_config, and cannot UPDATE
-- fleet_trucks directly. The hole was exactly these two functions.
--
-- ROOT CAUSE, and it is a one-line omission. Postgres grants EXECUTE on
-- a new function to PUBLIC by default. Migrations 012, 021 and 022 knew
-- this and wrote the REVOKE first:
--
--   REVOKE ALL ON FUNCTION ... FROM PUBLIC;
--   REVOKE EXECUTE ON FUNCTION ... FROM anon;
--   GRANT EXECUTE ON FUNCTION ... TO authenticated;
--
-- Migrations 033 (speeding) and 035 (station blacklist) granted without
-- revoking, so the default PUBLIC grant survived and anon inherited it.
-- This file applies the 012/021/022 pattern to every function we own.
--
-- SAFE TO APPLY, and here is why the tick does not break. service_role
-- holds an EXPLICIT grant on every one of these (`service_role=X/postgres`
-- in the ACL), so revoking PUBLIC/anon/authenticated does not touch it.
-- /api/tick calls runFleetTick(createServiceClient()), and the six
-- mark_trucks_* functions are reached ONLY from the fleet-wide checks in
-- tick.ts. The user-session path — runPositionCheck, behind the dispatch
-- "Check" button — issues no .rpc() call at all (positionCheck.ts lines
-- 84-319 contain none). Checked before writing this, in that order,
-- because 036 already taught this codebase that tightening a grant
-- before moving its callers is how you take the app down.

-- ── A. Tick-only. Service role and nothing else ───────────────────────
-- These write fleet state. No signed-in user has any business calling
-- them directly, and 012/022 already granted `authenticated` on four of
-- them unnecessarily — that is narrowed here too.
REVOKE ALL ON FUNCTION public.mark_trucks_speeding_state(text[], boolean)      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_trucks_station_state(text[], uuid)          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_trucks_factory_state(text[], boolean)       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_trucks_hq_state(text[], boolean)            FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_trucks_loading_state(text[], boolean)       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_trucks_site_state(text[], uuid)             FROM PUBLIC, anon, authenticated;

-- handle_new_user is a trigger on auth.users. A trigger fires as part of
-- the INSERT regardless of who holds EXECUTE, so revoking only removes
-- the ability to invoke it directly over /rest/v1/rpc — which nothing
-- should ever do. It was SECURITY DEFINER with no pinned search_path,
-- the one combination worth fixing without argument; see part E.
REVOKE ALL ON FUNCTION public.handle_new_user()                               FROM PUBLIC, anon, authenticated;

-- Recomputes a day of fleet metrics. Driven by the fleet-day-metrics
-- cron job, which runs as postgres. No caller in src/.
REVOKE ALL ON FUNCTION public.refresh_fleet_day_metrics(date)                 FROM PUBLIC, anon, authenticated;

-- ── B. Everything the app really calls: authenticated, never anon ─────
-- These are all SECURITY INVOKER, so RLS already stood between anon and
-- the data and the audit found no leak through them. Closing anon is
-- defence in depth plus one practical gain: on a hobby-tier database,
-- an open aggregate endpoint is free compute for anyone who finds it.
--
-- REVOKE FROM PUBLIC then GRANT TO authenticated, in that order — the
-- revoke alone would take the app's own access with it.
REVOKE ALL ON FUNCTION public.dashboard_daily_series(date, date, integer, text, text)     FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.dashboard_scope_options()                                   FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.driver_speeding_leaders(integer, date, date, text, text)    FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.driver_variance_leaders(integer, date, date)                FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.truck_variance_leaders(integer, date, date)                 FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fuel_period_stats(date, date, text, text)                   FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fuel_station_leaders(date, date, integer, text, text)       FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fuel_voyage_report(timestamptz, timestamptz, integer, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fleet_site_totals(timestamptz, timestamptz, integer)        FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fleet_site_visits(timestamptz, timestamptz, integer)        FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.geo_zone_totals(text, timestamptz, timestamptz)             FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.geo_zone_visits(text, timestamptz, timestamptz)             FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_geofences_geojson()                                     FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mark_my_notifications_read()                                FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.truck_track(text, timestamptz, timestamptz, double precision) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.unloaded_trucks(integer, integer, integer)                  FROM PUBLIC, anon;
-- norm_driver_name is not called from the app directly, but it IS called
-- inside dashboard_daily_series, dashboard_scope_options,
-- driver_speeding_leaders, fuel_period_stats and fuel_station_leaders.
-- Those are SECURITY INVOKER, so the signed-in caller needs EXECUTE on
-- it or all five fail. Checked, not assumed.
REVOKE ALL ON FUNCTION public.norm_driver_name(text)                                      FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.dashboard_daily_series(date, date, integer, text, text)     TO authenticated;
GRANT EXECUTE ON FUNCTION public.dashboard_scope_options()                                   TO authenticated;
GRANT EXECUTE ON FUNCTION public.driver_speeding_leaders(integer, date, date, text, text)    TO authenticated;
GRANT EXECUTE ON FUNCTION public.driver_variance_leaders(integer, date, date)                TO authenticated;
GRANT EXECUTE ON FUNCTION public.truck_variance_leaders(integer, date, date)                 TO authenticated;
GRANT EXECUTE ON FUNCTION public.fuel_period_stats(date, date, text, text)                   TO authenticated;
GRANT EXECUTE ON FUNCTION public.fuel_station_leaders(date, date, integer, text, text)       TO authenticated;
GRANT EXECUTE ON FUNCTION public.fuel_voyage_report(timestamptz, timestamptz, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fleet_site_totals(timestamptz, timestamptz, integer)        TO authenticated;
GRANT EXECUTE ON FUNCTION public.fleet_site_visits(timestamptz, timestamptz, integer)        TO authenticated;
GRANT EXECUTE ON FUNCTION public.geo_zone_totals(text, timestamptz, timestamptz)             TO authenticated;
GRANT EXECUTE ON FUNCTION public.geo_zone_visits(text, timestamptz, timestamptz)             TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_geofences_geojson()                                     TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_my_notifications_read()                                TO authenticated;
GRANT EXECUTE ON FUNCTION public.truck_track(text, timestamptz, timestamptz, double precision) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unloaded_trucks(integer, integer, integer)                  TO authenticated;
GRANT EXECUTE ON FUNCTION public.norm_driver_name(text)                                      TO authenticated;

-- ── C. Dormant. Nothing in src/ calls these, so nobody needs them ─────
-- Kept in the database rather than dropped, following the existing
-- convention that dead SQL is cheaper than a migration to undo (see the
-- driver_ratings note in the 2026-09-06 cleanup). Verified that none of
-- them is called from inside another function, so closing them cannot
-- break a live report. Fail closed: if a UI appears later, that
-- migration grants what it needs deliberately.
REVOKE ALL ON FUNCTION public.driver_ratings()                                            FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.factory_zone_summary(timestamptz, timestamptz)              FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.factory_zone_totals(timestamptz, timestamptz)               FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.factory_zone_visits(timestamptz, timestamptz, text)         FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.norm_site_name(text)                                        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.station_watch_radius(integer, boolean)                      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.upsert_site_geofence(uuid, text, text, uuid)                FROM PUBLIC, anon, authenticated;

-- Trigger helpers. A trigger runs as the table owner; no role needs
-- EXECUTE to make one fire.
REVOKE ALL ON FUNCTION public.touch_clients()                                             FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.touch_driver_directory()                                    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.touch_truck_service_baselines()                             FROM PUBLIC, anon, authenticated;

-- Cron plumbing and the sheet refresh. These already had no anon or
-- authenticated grant; the revoke is a no-op that states the intent so
-- the next reader does not have to check. pg_cron runs its jobs as
-- postgres, which owns them.
REVOKE ALL ON FUNCTION public.dispatch_fleet_tick()                                       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.dispatch_fuel_sync()                                        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prune_fleet_snapshots()                                     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prune_notifications()                                       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.refresh_fuel_transactions(jsonb)                            FROM PUBLIC, anon, authenticated;

-- ── D. Pin search_path on every function that lacked one ──────────────
-- An unpinned search_path on a SECURITY DEFINER function is a genuine
-- escalation route: the function resolves unqualified names against
-- whatever the caller's search_path says. handle_new_user was the one
-- that was both DEFINER and unpinned. The rest are SECURITY INVOKER,
-- where the risk is small — but the linter is right that there is no
-- reason to leave any of them open, and pinning changes no behaviour
-- because they all already reference public objects.
ALTER FUNCTION public.handle_new_user()                                    SET search_path = public, pg_temp;
ALTER FUNCTION public.factory_zone_summary(timestamptz, timestamptz)       SET search_path = public, pg_temp;
ALTER FUNCTION public.factory_zone_totals(timestamptz, timestamptz)        SET search_path = public, pg_temp;
ALTER FUNCTION public.factory_zone_visits(timestamptz, timestamptz, text)  SET search_path = public, pg_temp;
ALTER FUNCTION public.fleet_site_totals(timestamptz, timestamptz, integer) SET search_path = public, pg_temp;
ALTER FUNCTION public.fleet_site_visits(timestamptz, timestamptz, integer) SET search_path = public, pg_temp;
ALTER FUNCTION public.geo_zone_totals(text, timestamptz, timestamptz)      SET search_path = public, pg_temp;
ALTER FUNCTION public.geo_zone_visits(text, timestamptz, timestamptz)      SET search_path = public, pg_temp;
ALTER FUNCTION public.get_geofences_geojson()                              SET search_path = public, pg_temp;
ALTER FUNCTION public.norm_site_name(text)                                 SET search_path = public, pg_temp;
ALTER FUNCTION public.station_watch_radius(integer, boolean)               SET search_path = public, pg_temp;
ALTER FUNCTION public.touch_clients()                                      SET search_path = public, pg_temp;
ALTER FUNCTION public.touch_driver_directory()                             SET search_path = public, pg_temp;
ALTER FUNCTION public.touch_truck_service_baselines()                      SET search_path = public, pg_temp;
ALTER FUNCTION public.unloaded_trucks(integer, integer, integer)           SET search_path = public, pg_temp;
ALTER FUNCTION public.upsert_site_geofence(uuid, text, text, uuid)         SET search_path = public, pg_temp;

-- Nothing above changes a signature, so PostgREST's schema cache is not
-- stale — but a grant change IS something it caches, so tell it anyway.
NOTIFY pgrst, 'reload schema';
