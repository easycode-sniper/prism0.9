-- ━─ Geofence read/write RPCs ━──────────────────────────
-- supabase-js/PostgREST can't evaluate PostGIS functions inline on
-- insert or return geometry in a client-usable form, so these RPCs
-- do the ST_GeomFromText / ST_AsGeoJSON conversion server-side.

CREATE OR REPLACE FUNCTION public.get_geofences_geojson()
RETURNS TABLE (
  id             UUID,
  name           TEXT,
  kind           TEXT,
  site_id        UUID,
  center_lat     DOUBLE PRECISION,
  center_lng     DOUBLE PRECISION,
  radius_meters  INTEGER,
  polygon_geojson TEXT
)
LANGUAGE sql STABLE SECURITY INVOKER AS $$
  SELECT id, name, kind, site_id, center_lat, center_lng, radius_meters,
         ST_AsGeoJSON(polygon)
  FROM public.geofences;
$$;

GRANT EXECUTE ON FUNCTION public.get_geofences_geojson() TO authenticated;

-- Replaces any existing 'site' geofence for the given site with a new
-- polygon parsed from KML — one active geofence per site, most recent
-- upload wins.
CREATE OR REPLACE FUNCTION public.upsert_site_geofence(
  p_site_id UUID,
  p_name TEXT,
  p_polygon_wkt TEXT,
  p_created_by UUID
)
RETURNS UUID
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE
  v_id UUID;
BEGIN
  DELETE FROM public.geofences WHERE site_id = p_site_id AND kind = 'site';

  INSERT INTO public.geofences (name, kind, polygon, site_id, created_by)
  VALUES (
    p_name,
    'site',
    ST_SetSRID(ST_GeomFromText(p_polygon_wkt), 4326),
    p_site_id,
    p_created_by
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_site_geofence(UUID, TEXT, TEXT, UUID) TO authenticated;
