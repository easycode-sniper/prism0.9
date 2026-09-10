\pset format unaligned
\pset tuples_only on

-- ═══ 1. Name normalisation ═══════════════════════════════════════════
SELECT 'norm: case+accents  ' ||
  CASE WHEN norm_driver_name('HALLA Abderrezak') = norm_driver_name('halla abderrezak')
       THEN 'PASS' ELSE 'FAIL' END;
SELECT 'norm: token order    ' ||
  CASE WHEN norm_driver_name('AMIR SMARA') = norm_driver_name('SMARA Amir')
       THEN 'PASS' ELSE 'FAIL' END;
SELECT 'norm: accents        ' ||
  CASE WHEN norm_driver_name('LARBES Hacéne') = norm_driver_name('LARBES HACENE')
       THEN 'PASS' ELSE 'FAIL' END;
SELECT 'norm: real misspell NOT merged ' ||
  CASE WHEN norm_driver_name('ZEKRAOUI Abdelkader') <> norm_driver_name('Zakraoui abdelkader')
       THEN 'PASS' ELSE 'FAIL' END;
SELECT 'norm: distinct people stay distinct ' ||
  CASE WHEN norm_driver_name('HALLA Abderrezak') <> norm_driver_name('AMIR SMARA')
       THEN 'PASS' ELSE 'FAIL' END;

-- ═══ 2. FLEET-WIDE MUST BE UNCHANGED (regression guard) ══════════════
-- 5 fills, paired km 1000+500+2000+200 = 3700, litres 500+250+1000+100+100=1950
SELECT 'fleet stats unchanged ' || CASE WHEN fills = 5 AND km = 3700 AND litres = 1950
         AND unpaired_fills = 1 AND unpaired_amount_da = 5000
       THEN 'PASS' ELSE 'FAIL got fills=' || fills || ' km=' || km || ' litres=' || litres END
FROM fuel_period_stats(NULL, NULL);

-- fleet km per day still comes from telemetry, NOT the sheet
SELECT 'fleet km = telemetry  ' || CASE WHEN sum(km) = 9999 + 8888
       THEN 'PASS' ELSE 'FAIL got ' || COALESCE(sum(km)::text,'null') END
FROM dashboard_daily_series('2026-09-01', '2026-09-02');

-- fleet deliveries: 4 qualifying site visits (one 10-min visit excluded,
-- factory excluded)
SELECT 'fleet deliveries      ' || CASE WHEN sum(deliveries) = 4
       THEN 'PASS' ELSE 'FAIL got ' || COALESCE(sum(deliveries)::text,'null') END
FROM dashboard_daily_series('2026-09-01', '2026-09-02', 1500);

-- ═══ 3. TRUCK SCOPE ══════════════════════════════════════════════════
-- T-100: fills f1,f2,f5 = 3; paired km 1000+500+200 = 1700
SELECT 'truck stats           ' || CASE WHEN fills = 3 AND km = 1700
       THEN 'PASS' ELSE 'FAIL got fills=' || fills || ' km=' || km END
FROM fuel_period_stats(NULL, NULL, NULL, 'T-100');

-- km now comes from the SHEET, not the 9999/8888 telemetry
SELECT 'truck km = sheet      ' || CASE WHEN sum(km) = 1700
       THEN 'PASS' ELSE 'FAIL got ' || COALESCE(sum(km)::text,'null') END
FROM dashboard_daily_series('2026-09-01','2026-09-02', 1500, NULL, 'T-100');

-- T-100 deliveries: SITE A, SITE B, SITE E = 3 (factory excluded)
SELECT 'truck deliveries      ' || CASE WHEN sum(deliveries) = 3
       THEN 'PASS' ELSE 'FAIL got ' || COALESCE(sum(deliveries)::text,'null') END
FROM dashboard_daily_series('2026-09-01','2026-09-02', 1500, NULL, 'T-100');

-- T-100 alerts: 2 speeding + 1 off_route = 3
SELECT 'truck alerts          ' || CASE WHEN sum(alerts) = 3
       THEN 'PASS' ELSE 'FAIL got ' || COALESCE(sum(alerts)::text,'null') END
FROM dashboard_daily_series('2026-09-01','2026-09-02', 1500, NULL, 'T-100');

-- ═══ 4. DRIVER SCOPE, ACROSS SOURCES ═════════════════════════════════
-- HALLA: sheet spells "HALLA Abderrezak", tracker "HALLA ABDERREZAK" and
-- "halla abderrezak". Fuel = f1+f2 (2 fills, 1500 km).
SELECT 'driver stats          ' || CASE WHEN fills = 2 AND km = 1500
       THEN 'PASS' ELSE 'FAIL got fills=' || fills || ' km=' || km END
FROM fuel_period_stats(NULL, NULL, 'HALLA Abderrezak', NULL);

-- ...and his deliveries come from the TRACKER's spelling: SITE A + SITE B = 2
SELECT 'driver deliveries x-source ' || CASE WHEN sum(deliveries) = 2
       THEN 'PASS' ELSE 'FAIL got ' || COALESCE(sum(deliveries)::text,'null') END
FROM dashboard_daily_series('2026-09-01','2026-09-02', 1500, 'HALLA Abderrezak', NULL);

-- reversed token order: sheet "AMIR SMARA" vs tracker "SMARA Amir".
-- Deliveries = SITE C only (SITE D is 10 min, under the threshold).
SELECT 'driver reordered name ' || CASE WHEN sum(deliveries) = 1
       THEN 'PASS' ELSE 'FAIL got ' || COALESCE(sum(deliveries)::text,'null') END
FROM dashboard_daily_series('2026-09-01','2026-09-02', 1500, 'AMIR SMARA', NULL);

-- querying by the TRACKER spelling must give the same fuel as the sheet one
SELECT 'driver either spelling ' || CASE WHEN
       (SELECT fills FROM fuel_period_stats(NULL,NULL,'SMARA Amir',NULL))
     = (SELECT fills FROM fuel_period_stats(NULL,NULL,'AMIR SMARA',NULL))
       THEN 'PASS' ELSE 'FAIL' END;

-- the genuine misspelling stays SPLIT: the sheet name gets the fuel and
-- no deliveries; that is the documented limit, asserted so it cannot
-- change silently.
SELECT 'misspelling stays split ' || CASE WHEN
       (SELECT fills FROM fuel_period_stats(NULL,NULL,'Zakraoui abdelkader',NULL)) = 1
   AND (SELECT COALESCE(sum(deliveries),0) FROM dashboard_daily_series('2026-09-01','2026-09-02',1500,'Zakraoui abdelkader',NULL)) = 0
       THEN 'PASS' ELSE 'FAIL' END;

-- ═══ 5. SPEEDING, SCOPED ═════════════════════════════════════════════
SELECT 'speeding fleet (staff excluded) ' || CASE WHEN (SELECT sum(times) FROM driver_speeding_leaders(100)) = 3
       THEN 'PASS' ELSE 'FAIL got ' || COALESCE((SELECT sum(times) FROM driver_speeding_leaders(100))::text,'null') END;
SELECT 'speeding by truck     ' || CASE WHEN (SELECT sum(times) FROM driver_speeding_leaders(100,NULL,NULL,NULL,'T-100')) = 2
       THEN 'PASS' ELSE 'FAIL' END;
SELECT 'speeding by driver    ' || CASE WHEN (SELECT sum(times) FROM driver_speeding_leaders(100,NULL,NULL,'halla abderrezak',NULL)) = 2
       THEN 'PASS' ELSE 'FAIL' END;

-- ═══ 5b. STATION DONUT, SCOPED ═══════════════════════════════════════
-- Fleet: NAFTAL A has f1,f2,f5 = 3 fills; NAFTAL B has f3,f4 = 2.
SELECT 'stations fleet        ' || CASE WHEN
       (SELECT total_fills FROM fuel_station_leaders(NULL,NULL,6) LIMIT 1) = 5
       THEN 'PASS' ELSE 'FAIL' END;
-- T-200 only ever fills at NAFTAL B: one station, two fills.
SELECT 'stations by truck     ' || CASE WHEN
       (SELECT count(*) FROM fuel_station_leaders(NULL,NULL,6,NULL,'T-200')) = 1
   AND (SELECT total_fills FROM fuel_station_leaders(NULL,NULL,6,NULL,'T-200') LIMIT 1) = 2
       THEN 'PASS' ELSE 'FAIL' END;
SELECT 'stations by driver    ' || CASE WHEN
       (SELECT total_fills FROM fuel_station_leaders(NULL,NULL,6,'halla abderrezak',NULL) LIMIT 1) = 2
       THEN 'PASS' ELSE 'FAIL' END;

-- ═══ 6. THE PICKER'S ROSTER ══════════════════════════════════════════
SELECT 'scope options: trucks ' || CASE WHEN (SELECT count(*) FROM dashboard_scope_options() WHERE kind='truck') = 2
       THEN 'PASS' ELSE 'FAIL got ' || (SELECT count(*) FROM dashboard_scope_options() WHERE kind='truck')::text END;
-- HALLA, SMARA, and the two spellings of the misspelled man = 4 drivers
SELECT 'scope options: drivers ' || CASE WHEN (SELECT count(*) FROM dashboard_scope_options() WHERE kind='driver') = 4
       THEN 'PASS' ELSE 'FAIL got ' || (SELECT count(*) FROM dashboard_scope_options() WHERE kind='driver')::text END;
SELECT 'scope options: no empty labels ' || CASE WHEN NOT EXISTS
       (SELECT 1 FROM dashboard_scope_options() WHERE label IS NULL OR btrim(label) = '')
       THEN 'PASS' ELSE 'FAIL' END;

\echo '--- scope options as the picker will see them ---'
\pset tuples_only off
\pset format aligned
SELECT kind, id, label, fills, visits FROM dashboard_scope_options();
