-- Stop app_config handing the Wialon token to every signed-in user.
--
-- The table held two very different things behind one policy:
--
--   fuel   { litres_per_100km }        — a rate the dashboard shows
--   wialon { relay, server, token }    — the fleet API CREDENTIAL
--
-- and "App config viewable by authenticated users" granted SELECT with
-- qual TRUE over both. Any operator with a session could read the token
-- straight out of the table.
--
-- ORDER MATTERS, and the code half already shipped (commit 4b98943).
-- Two non-admin paths used to resolve the credential with the CALLER's
-- session — listDrivers(), which every operator hits, and
-- getFleetData()/findWialonUnit() — so tightening this first would have
-- broken the Drivers page for operators. Those now read it with the
-- service role, which bypasses RLS, so this policy can close without
-- taking anything with it.

DROP POLICY IF EXISTS "App config viewable by authenticated users" ON public.app_config;

-- FAIL CLOSED: an allow-list of keys that are safe to publish, not a
-- deny-list of secret ones. A key added later is unreadable by
-- operators until someone deliberately names it here — which is the
-- right way round for a table that stores credentials. Getting it
-- backwards is how the token was exposed in the first place.
CREATE POLICY "Public app config readable by authenticated users"
  ON public.app_config
  FOR SELECT
  TO authenticated
  USING (config_key = ANY (ARRAY['fuel']));

-- The admin policy ("Admins can manage app config", FOR ALL) is left
-- alone and still covers SELECT on every key, which is what
-- adminGetSettings needs to show whether a token is set.
--
-- The service role bypasses RLS entirely and is unaffected: the tick,
-- the Wialon config resolver and the settings write all go through it.
