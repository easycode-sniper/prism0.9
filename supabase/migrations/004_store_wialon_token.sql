-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- PRISM — Store Wialon token in app_config
-- ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
-- Run this ONCE to store the Wialon API token securely
-- in Supabase (server-side only, never exposed to browser).
--
-- After running, the token is read by the server-side
-- Wialon client and used to authenticate with Wialon
-- via the Cloudflare relay.

UPDATE public.app_config
SET config_value = '{"relay": "https://wialon-relay1.ferdjellahsouhaibomd.workers.dev", "server": "hst-api.wialon.eu", "token": "320891517e06a26d588d3174f9414638811A365C73F5F3BAB3B16EFC1BA0D39D393E777C"}'
WHERE config_key = 'wialon';
