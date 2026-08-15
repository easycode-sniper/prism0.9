-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- PRISM — Store Wialon token in app_config
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- Run this ONCE to seed app_config with a placeholder.
-- Do NOT put the real Wialon API token in this file — it
-- gets committed to source control. Set the real token
-- afterward via Admin → Settings in the app (writes to
-- this same app_config row through adminSaveSettings),
-- or directly in the Supabase dashboard's table editor.
--
-- SECURITY NOTE: an earlier version of this migration had
-- the real token hardcoded here and was committed to git.
-- That token must be treated as compromised and rotated in
-- Wialon, independent of this fix — editing this file does
-- not remove it from git history.

UPDATE public.app_config
SET config_value = '{"relay": "https://wialon-relay1.ferdjellahsouhaibomd.workers.dev", "server": "hst-api.wialon.eu", "token": ""}'
WHERE config_key = 'wialon';
