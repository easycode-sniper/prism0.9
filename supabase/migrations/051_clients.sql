-- ━─ Clients: the delivery-point directory ━───────────────────────────
--
-- Imported from the owner's "CHANTIER AMOUDA" sheet, 130 rows. It is the
-- same sheet construction_sites was built from, so the two are linked —
-- but NOT on the sheet's N° column, and that trap is worth recording.
--
-- site_code in construction_sites really is 'site_1', 'site_2', … and for
-- the first 61 rows it does line up with N° exactly; an eight-row spot
-- check against it passed. The column is nonetheless unusable as a key:
-- N° restarts at 1 at spreadsheet rows 67 and 123, and jumps backwards
-- four more times (34→26, 39→36, 13→9, 14→10). It is hand-kept numbering
-- for several appended blocks, not a row id. Joining on it would have
-- silently attached roughly 69 clients to the wrong site — plausible
-- rows, wrong data, no error anywhere.
--
-- So the link is made on the delivery-point name instead, normalised for
-- case, accents and punctuation, and the match rate is asserted at the
-- bottom of this file rather than assumed.
--
-- ONE ROW PER DELIVERY POINT, NOT PER COMPANY. 130 rows carry only 78
-- distinct client codes, and the duplicates are not noise: code 1692 is
-- EMESA at Bou Hanifia AND at Bouira, with a different phone number and
-- different hours at each. Phone, hours and the commercial rep are
-- properties of the place a truck is sent to, so that is the grain. A
-- company with three sites is three rows, which is also how dispatch
-- thinks about it.
--
-- THE HOURS COLUMN IS PARSED, NOT STORED AS TYPED. The source held 50
-- distinct spellings of about four ideas — "24/24", "24H/24, 7 jours/7",
-- "07H-00H", "08h00 à 23h00", "Fermeture 18 h", "7/7 J FERMITURE 23H00",
-- one cell Excel had silently coerced to the time 18:00:00 — which no
-- page could answer "is this client open now?" from. They are split into
-- is_24h / opens_at / closes_at / friday_excluded / seven_days, and
-- hours_raw keeps the original string forever, because a parser that
-- discards its input cannot be audited when it gets one wrong.
--
-- "07H-00H" means closing at midnight, so it is stored as 24:00 rather
-- than 00:00 — Postgres accepts 24:00:00 in a time column, and 00:00
-- would make every one of those 31 clients look shut all day.
--
-- Coverage after parsing: 99/130 have a phone, 121/130 have usable
-- hours, 110/130 a rep, 126/130 a distance. The rest are blank in the
-- source, not dropped by the import.

CREATE TABLE IF NOT EXISTS public.clients (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The sheet's own N°. NOT UNIQUE and NOT A KEY — see the header. Kept
  -- only so a row can be found again in the owner's spreadsheet.
  sheet_row       integer,
  client_code     text,
  name            text NOT NULL,
  -- Several cells hold two numbers; one holds a Turkish WhatsApp number,
  -- which is why phone_note exists rather than silently normalising it
  -- into an Algerian one.
  phones          text[] NOT NULL DEFAULT '{}',
  phone_note      text,
  rep             text,
  site_name       text,
  site_id         uuid REFERENCES public.construction_sites(id) ON DELETE SET NULL,
  distance_km     numeric,
  is_24h          boolean,
  opens_at        time,
  closes_at       time,
  friday_excluded boolean,
  seven_days      boolean,
  hours_raw       text,
  created_at      timestamptz NOT NULL DEFAULT NOW(),
  updated_at      timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS clients_site_id_idx ON public.clients (site_id);
CREATE INDEX IF NOT EXISTS clients_client_code_idx ON public.clients (client_code);

ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;

-- Reading is open to any authenticated user: dispatch needs to ring a
-- client and check whether the site is still open. Writing is admin-only,
-- the shape 024 arrived at for driver_directory — except it is here from
-- the start rather than after months of edits having to go through the
-- SQL editor.
CREATE POLICY "clients_select" ON public.clients
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "clients_write_admin" ON public.clients
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin'));

CREATE OR REPLACE FUNCTION public.touch_clients()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS clients_touch ON public.clients;
CREATE TRIGGER clients_touch BEFORE UPDATE ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.touch_clients();

-- Shared by the link below and by anything that later has to reconcile a
-- spreadsheet name against a site.
CREATE OR REPLACE FUNCTION public.norm_site_name(txt text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT regexp_replace(
           regexp_replace(
             upper(translate(coalesce(txt, ''),
                             'ÀÁÂÃÄÅàáâãäåÈÉÊËèéêëÌÍÎÏìíîïÒÓÔÕÖòóôõöÙÚÛÜùúûüÇç''’–—',
                             'AAAAAAaaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCc   ')),
             '[^A-Z0-9]+', ' ', 'g'),
           '\s+', ' ', 'g')
$$;

INSERT INTO public.clients
  (sheet_row, client_code, name, phones, phone_note, rep, site_name, distance_km,
   is_24h, opens_at, closes_at, friday_excluded, seven_days, hours_raw)
VALUES
  (1, '2147', 'SPA COSIDER OUVRAGE D''ART - A81 -', ARRAY['+213697812583']::text[], NULL, 'Hocine samir', 'A81 ADRAR', 1200.0, false, '07:00', '20:00', false, NULL, '07H-20H'),
  (2, '2031', 'ATTIA AMMAR', ARRAY['+213550704424']::text[], NULL, 'Ahmed allout', 'AFLOU - ATTIA', 50.0, false, '07:00', '24:00', false, NULL, '07H-00H'),
  (3, '2174', 'SARL ZIRAKAM BETON', ARRAY['+213773165716']::text[], NULL, 'Brahmi Rabah', 'ZIRAKAM Aïn Oussara', 215.0, false, '07:00', '24:00', true, NULL, '07H-00H vendredi exclu'),
  (4, '1029', 'SARL WAFA DOUX', ARRAY['+213560841292']::text[], NULL, 'Anis dehimi', 'AIN OUSSARA - WAFA 3', 200.0, false, '07:00', '24:00', false, NULL, '07H-00H'),
  (5, '1986', 'EURL GOUNEIBER TRAVAUX PUBLICS', ARRAY['+213660523156']::text[], NULL, 'Oussama MAHAMMEDI', 'Ain Sefra - NAAMA', 400.0, false, '07:00', '24:00', true, NULL, '07H-00H vendredi exclu'),
  (6, '2141', 'E.T.P BENZAMIA, DJELFA', ARRAY['+213661218088','+213560059412']::text[], NULL, 'Ahmed allout', 'BENZAMIA DJELFA', 160.0, false, '06:00', '21:00', false, NULL, '06H-21H'),
  (7, '2095', 'SOCIETE SINOSTEEL ENGIEERING DESIGN RESEARCH INSTITUTE CO, LTD', ARRAY['+213559901766']::text[], NULL, 'BOUSETTA BOUMEDIENE ABDESSAMED', 'BETHIOUA ORAN', 379.0, true, NULL, NULL, false, NULL, '24/24'),
  (8, '1788', 'SARL ASLAN CONSTRUCTION ET COMMERCE', ARRAY['+213561663129','+213540705675']::text[], NULL, 'Hocine samir', 'BIR MOURAD RAIS', 410.0, false, '16:00', '23:00', false, NULL, '16H-23H'),
  (9, '1692', 'SARL EMESA CONTRACT, BOU HANIFIA', ARRAY['+213772310420']::text[], NULL, 'BOUSETTA BOUMEDIENE ABDESSAMED', 'EMESA BOU HANIFIA', 277.0, true, NULL, NULL, true, NULL, '24/24 vendredi exclu'),
  (10, '2032', 'SARL LOUIFI PROJECTS', ARRAY['+213555735581']::text[], NULL, 'Anis dehimi', 'LOUIFI BOUFARIK', 383.0, false, '07:00', '20:00', true, NULL, '07H-20H vendredi exclu'),
  (11, '2198', 'SARL BIG ROAD TRAVAUX PUBLICS ET HYDRAULIQUES Client 2198', ARRAY['+213662731712']::text[], NULL, 'Hocine samir', 'BIG ROAD BOUGHEZOUL', 245.0, false, '07:00', '18:00', false, NULL, '07H-18H'),
  (12, '2122', 'EURL CEDY ALGERIE BEST CONSTRUCTION', ARRAY['+213662538019','+213663306091']::text[], NULL, 'Hocine samir', 'CEDY BOUGHZOUL', 240.0, false, '07:00', '20:00', true, NULL, '07H-20H vendredi exclu'),
  (13, '1692', 'SARL EMESA CONTRACT', ARRAY['+213773165716']::text[], NULL, 'BOUSETTA BOUMEDIENE ABDESSAMED', 'EMESA BOUIRA', 410.0, true, NULL, NULL, true, NULL, '24H/24H vendredi exclu'),
  (14, '1735', 'SARL ABRAJ INJAZ, BOUJLIDA / TLEMCEN', ARRAY['+213550926759']::text[], NULL, 'BOUSETTA BOUMEDIENE ABDESSAMED', 'BOUJLIDA / TLEMCEN', 434.0, false, '07:00', '24:00', false, NULL, '07H-00H'),
  (15, '1974', 'EURL ETB KHENCHALI ALI', ARRAY['+213560073998']::text[], NULL, 'Oussama MAHAMMEDI', 'BREZINA EL Bayaydh', 235.0, false, '07:00', '20:00', true, NULL, '07H-20H vendredi exclu'),
  (16, '2164', 'SARL SOPREC , CHAREF DJELFA', ARRAY['+213560085119']::text[], NULL, 'Ahmed allout', 'CHAREF DJELFA', 100.0, true, NULL, NULL, true, NULL, '24/24H vendredi exclu'),
  (17, '2035', 'SARL WATER WAAPS ALGERIE', ARRAY['+213560621402']::text[], NULL, 'Oussama MAHAMMEDI', 'CHETIA CHLEF', 345.0, false, '07:00', '20:00', false, NULL, '07H-20H'),
  (18, '2072', 'SPA SOCIETE DES GRANULATS D''ALGERIE SGA', ARRAY['+213770123665','+213660636555']::text[], NULL, 'Anis dehimi', 'DJELFA GRANU CENTRE', 160.0, false, '07:00', '20:00', false, NULL, '07H-20H'),
  (19, '2118', 'SOCIETE ALGERIENNE DE L''INNOVATION ET DU DEVELOPEMENT', ARRAY['+213557678604']::text[], NULL, 'Ahmed allout', 'DJELFA SAID', 160.0, true, NULL, NULL, false, NULL, '24/24'),
  (20, '1687', 'SPA ATLAS GENIE CIVIL COMPANY', ARRAY['+905362995995']::text[], 'whatsapp', 'BOUSETTA BOUMEDIENE ABDESSAMED', 'El Affroun-Blida', 360.0, true, NULL, NULL, false, NULL, '24/24'),
  (21, '2115', 'SARL W.G.A.M', ARRAY['+213542641531']::text[], NULL, 'hamid boussadi', 'W.G.A.M EL MENIA', 640.0, false, '07:00', '17:00', false, NULL, '07H-17H'),
  (22, '2166', 'SPA TRAVOCOVIA, EL MENIA', ARRAY['+213561754973']::text[], NULL, 'Anis dehimi', 'TRAVOCOVIA EL MENIA', 597.0, false, '07:00', '20:00', false, NULL, '07H-20H'),
  (23, '2185', 'COSIDER CANALISATION PÔLE C58, GDYEL', ARRAY['+213660179818']::text[], NULL, 'Oussama MAHAMMEDI', 'GDYEL', 400.0, false, '07:00', '24:00', false, NULL, '07H-00H'),
  (24, '2183', 'EURL ETPBH S BOUZIDA/ E.T.B SARL OZGUR-SAN', ARRAY['+213563028012','+213563028119']::text[], NULL, 'Hocine samir', 'HASSI DELAA', 250.0, false, '07:00', '17:00', false, NULL, '07H-17H'),
  (25, '2016', 'SARL HYDRO DAMAS', ARRAY['+213660630251']::text[], NULL, 'BOUSETTA BOUMEDIENE ABDESSAMED', 'Hassi R''mel', 250.0, false, '07:00', '24:00', false, NULL, '07H-00H'),
  (26, '1297', 'SARL ELBAYRAK CONSTRUCTION', ARRAY['+213671493194']::text[], NULL, 'BOUSETTA BOUMEDIENE ABDESSAMED', 'ELBAYRAK HMD', 640.0, false, '07:00', '24:00', false, NULL, '07H-00H'),
  (27, '1788', 'SARL ASLAN CONSTRUCTION ET COMMERCE KOUBA Client 1788', ARRAY['+213656125350']::text[], NULL, 'Hocine samir', 'KOUBA', 410.0, false, '07:00', '24:00', false, NULL, '07H-00H'),
  (28, '1012', 'SARL Houria Services Client 1012', ARRAY['+213661857085']::text[], NULL, 'Hocine samir', 'LAGHOUAT - AIN MADI', 150.0, true, NULL, NULL, false, NULL, '24/24'),
  (29, '2073', 'SPA SOCIETE DES GRANULATS D''ALGERIE SGA', ARRAY['+213660208493']::text[], NULL, 'Anis dehimi', 'LAGHOUAT - GRANU', 151.0, false, '07:00', '20:00', true, NULL, '07H-20H vendredi exclu'),
  (30, '2118', 'SOCIETE ALGERIENNE DE L''INNOVATION ET DU DEVELOPEMENT - S.A.I.D, SARL SAID- LAGHOUAT ZONE MILITAIRE', ARRAY['+213557678604']::text[], NULL, 'Ahmed allout', 'ZONE MILITAIRE LAGHOUAT SAID', 142.0, true, NULL, NULL, false, NULL, '24/24'),
  (31, '2118', 'SOCIETE ALGERIENNE DE L''INNOVATION ET DU DEVELOPEMENT S.A.I.D, SARL SAID- LAGHOUAT MONTAGNE 2', ARRAY['+213557678604']::text[], NULL, 'Ahmed allout', 'ZONE 2 LAGHOUAT SAID', 142.0, true, NULL, NULL, false, NULL, '24/24'),
  (32, '1735', 'SARL ABRAJ INJAZ Client 1735', ARRAY['+213550926759']::text[], NULL, 'BOUSETTA BOUMEDIENE ABDESSAMED', 'MAGHNIA', 540.0, false, '07:00', '24:00', false, NULL, '07H-00H'),
  (33, '2189', 'EURL BEZZIA TRAVAUX , MEDEA', ARRAY['+213770618980','+213550999649']::text[], NULL, 'Brahmi Rabah', 'MEDEA', 320.0, false, '07:00', '19:00', true, NULL, '07H00 a 19h00 vendredi exclu'),
  (34, '2125', 'SARL DARKAOUI ET ASSOCIES', ARRAY['+213772700472']::text[], NULL, 'Oussama MAHAMMEDI', 'MEKMEN BENAMAR NAAMA', 370.0, true, NULL, NULL, false, NULL, '24/24'),
  (35, '1043', 'SARL DARKAOUI ET ASSOCIES', ARRAY['+213697548484']::text[], NULL, 'Ahmed allout', 'MEKMEN BENAMAR NAAMA', 370.0, false, '07:00', '24:00', false, NULL, '07H-00H'),
  (36, '1012', 'SARL Houria Services', ARRAY['+213661857085']::text[], NULL, 'Hocine samir', 'Houria NAAMA', 361.0, false, '07:00', '24:00', false, NULL, '07H-00H'),
  (37, '1760', 'SARL MOUILAH DEVELOPEMENT', ARRAY['+213560393143']::text[], NULL, 'BOUSETTA BOUMEDIENE ABDESSAMED', 'ORAN - MOUILAH', 395.0, false, '07:00', '24:00', false, NULL, '07H-00H'),
  (38, '1788', 'SARL ASLAN CONSTRUCTION ET COMMERCE', ARRAY['+213558296048']::text[], NULL, 'Hocine samir', 'OUARGLA - ASLAN', 525.0, false, '07:00', '24:00', false, NULL, '07H-00H'),
  (39, '2193', 'COSIDER CANALISATIONS POLE H 67 ADRAR, Projet : AGRECO', ARRAY['+213655353702','+213671013237']::text[], NULL, 'Hocine samir', 'POLE H 67 ADRAR', 1150.0, false, '07:00', '20:00', false, NULL, '07H-20H'),
  (40, '2061', 'HKO SARL HANNACHI KHEMISSA ET OTHMANI TRAVAUX PUBLIK', ARRAY['+213561627700']::text[], NULL, 'Anis dehimi', 'ROUIBA - HKO', 430.0, false, '07:00', '20:00', true, NULL, '07H-20H vendredi exclu'),
  (41, '1297', 'SARL ELBAYRAK CONSTRUCTION', ARRAY['+213799301335']::text[], NULL, 'BOUSETTA BOUMEDIENE ABDESSAMED', 'ELBAYRAK SAIDA', 250.0, false, '07:00', '24:00', false, NULL, '07H-00H'),
  (42, '2148', 'SPA HASNAOUI', ARRAY['+213660205915']::text[], NULL, 'Oussama MAHAMMEDI', 'HASNAOUI SIDI BELABBES', 400.0, false, '07:00', '24:00', true, NULL, '07H-00H vendredi exclu'),
  (43, '1012', 'SARL Houria Services', ARRAY['+213699318277']::text[], NULL, 'Hocine samir', 'SIDI MOUSSA', 410.0, true, NULL, NULL, false, NULL, '24/24'),
  (44, '1012', 'SARL Houria Services', ARRAY['+213699318277']::text[], NULL, 'Hocine samir', 'SIDI MOUSSA 2', 414.0, false, '07:00', '24:00', true, NULL, '07H-00H vendredi exclu'),
  (45, '2038', 'COSIDER CANALISATIONS DO1', ARRAY['+213660328474','+213661949713']::text[], NULL, 'Hocine samir', 'TIGZIRT - D01', 560.0, false, '07:00', '24:00', false, NULL, '07H-00H'),
  (46, '2171', 'GROUPE BOUROUAG CONSTRUCTION GBC', ARRAY['+213555024940']::text[], NULL, 'BOUSETTA BOUMEDIENE ABDESSAMED', 'TISEMSILET - GBC', 213.0, false, '07:00', '18:00', false, NULL, '07H-18H'),
  (47, '1297', 'SARL ELBAYRAK CONSTRUCTION, TISSEMSILT', ARRAY['+213658735403']::text[], NULL, 'BOUSETTA BOUMEDIENE ABDESSAMED', 'TISEMSILET - ELBAYREK', 213.0, false, '07:00', '24:00', false, NULL, '07H-00H'),
  (48, '2151', 'CSCEC algerie 520 GPS Client 2151', ARRAY['+213655903010']::text[], NULL, 'Hocine samir', 'ZERALDA', 418.0, true, NULL, NULL, true, NULL, '24/24 vendredi exclu'),
  (49, '2204', 'RESI BETON, LES EUCALYPTUS', ARRAY['+213561912302']::text[], NULL, 'BOUSETTA BOUMEDIENE ABDESSAMED', 'EUCALYPTUS', 410.0, false, '07:00', '24:00', false, NULL, '07H-00H'),
  (50, '2205', 'SOCIETE SINOSTEEL ENGIEERING DESIGN RESEARCH INSTITUTE CO, LTD/TINDOUF, GARA DJBILAT', ARRAY['+213654832591']::text[], NULL, 'BOUSETTA BOUMEDIENE ABDESSAMED', 'TINDOUF, GARA DJBILAT', 1561.0, true, NULL, NULL, false, NULL, '24H/24H'),
  (51, '2208', 'SARL AZZEDINE ET CHABANE CONSTRUCTION, DJELFA', ARRAY['+213660436860']::text[], NULL, 'BOUSETTA BOUMEDIENE ABDESSAMED', 'DJELFA AZZEDINE ET CHABANE', 140.0, false, '07:00', '19:00', false, NULL, '07H-19H'),
  (52, '2124', 'SPA SOCIETE DES GRANULATS SGA - MASCARA', ARRAY['+213670153609']::text[], NULL, 'Anis dehimi', 'GRANULATS MASCARA', 261.0, false, '07:00', '20:00', true, NULL, '07H-20H vendredi exclu'),
  (53, '1692', 'SARL EMESA CONTRACT, oran', ARRAY['+213797124125']::text[], NULL, 'BOUSETTA BOUMEDIENE ABDESSAMED', 'ORAN - EMESA', 411.0, true, NULL, NULL, true, NULL, '24H/24H vendredi exclu'),
  (54, '2100', 'GRANULA - SPA SGA - Mostaganem', ARRAY['+213661465678']::text[], NULL, 'Anis dehimi', 'GRANULA MOSTAGANEM', 341.0, false, '07:00', '20:00', false, NULL, '07H-20H'),
  (55, '2217', 'SARL ZCIGC CONSTRUCTION ALGERIE, DJELFA', ARRAY['+213770470745']::text[], NULL, 'Anis dehimi', 'DJELFA ZCIGC', 158.0, false, '07:00', '24:00', true, NULL, '07H-00H vendredi exclu'),
  (56, '1012', 'SARL Houria Services, BEIDHA, LAGHOUAT', ARRAY['+213699712637']::text[], NULL, 'Hocine samir', 'LAGHOUAT - HOURIA', 166.0, false, '07:00', '24:00', false, NULL, '07H-00H'),
  (57, '1470', 'EURL GBS ROUTE , tiaret', ARRAY['+213660734909']::text[], NULL, 'Brahmi Rabah', 'GBS TIARET', 154.0, false, '07:00', '24:00', false, NULL, '07H-00H'),
  (58, '2172', 'SARL ATBM BETON ET AGGLOMERES', '{}', NULL, 'Oussama MAHAMMEDI', 'CHELF ATBM', 309.0, false, '07:00', '24:00', true, NULL, '07H-00H vendredi exclu'),
  (59, '1945', 'SARL BETON ORAN - SBO, ORAN CHTAIBOU SBO', ARRAY['+213555038588']::text[], NULL, 'Oussama MAHAMMEDI', 'ORAN SBO', 394.0, false, '07:00', '24:00', false, NULL, '07H-00H'),
  (60, '2223', 'COSIDER CANALISATION H 71 IN SALAH', ARRAY['+213660373357']::text[], NULL, 'Hocine samir', 'AIN SALAH', 936.0, false, '07:00', '24:00', false, NULL, '07H-00H'),
  (61, '1974', 'EURL ETB KHENCHALI ALI, LABYAD SIDI CHIKH', ARRAY['+213560073998']::text[], NULL, 'Oussama MAHAMMEDI', 'KHENCHALI LABYAD SIDI CHIKH', 300.0, true, NULL, NULL, false, NULL, '24/24'),
  (1, '1692', 'SARL EMESA CONTRACT Client 1692', '{}', NULL, 'BOUSETTA BOUMEDIENE ABDESSAMED', 'EMESA AIN OUSSARA', 200.0, true, NULL, NULL, true, NULL, '24H/24H vendredi exclu'),
  (2, '2081', 'COSIDER CANALISATION R 01 BECHAR', ARRAY['+213670165130']::text[], NULL, 'Hocine samir', 'BENI ABBES /BECHAR R01', 830.0, true, NULL, NULL, false, NULL, '24H/24H'),
  (3, '2120', 'CSCEC PROJET TINDOUF hôpital 240 lits', '{}', NULL, 'BOUSETTA BOUMEDIENE ABDESSAMED', 'CSCEC - TINDOUF', 1460.0, false, '07:00', '24:00', false, NULL, '07H-00H'),
  (4, '1887', 'SPA COSIDER CANALISATION POLE H38', ARRAY['+213660437844']::text[], NULL, 'Hocine samir', 'DAMOUS TIPAZA', 540.0, false, '07:00', '20:00', true, NULL, '07H-20H vendredi exclu'),
  (5, '2140', 'COSIDER POLE A 79 TINDOUF', ARRAY['+213660843492']::text[], NULL, 'Hocine samir', 'TINDOUF COSIDER A 79', 1460.0, false, '07:00', '24:00', false, NULL, '07H-00H'),
  (6, '2091', 'SARL EL OUANCHARISE LI TOROQAT', ARRAY['+213660440431']::text[], NULL, 'Brahmi Rabah', 'EL OUANCHARISE TISEMSILET', 213.0, false, '07:00', '24:00', false, NULL, '07H-00H'),
  (7, '1735', 'SARL ABRAJ INJAZ Client 1735', ARRAY['+213784504708','+213770808255']::text[], NULL, 'BOUSETTA BOUMEDIENE ABDESSAMED', 'ABRAJ MOSTAGANEM', 350.0, false, '07:00', '24:00', false, NULL, '07H-00H'),
  (8, '2101', 'SPA SOCIETE DES GRANULATS SGA-SIDI BEL ABBES', ARRAY['+213660205915']::text[], NULL, 'Anis dehimi', 'GRANULATS SIDI BEL ABBES', 327.0, false, '07:00', '20:00', false, NULL, '07H-20H'),
  (9, '1735', 'SARL ABRAJ INJAZ, TIARET', ARRAY['+213772880494']::text[], NULL, 'BOUSETTA BOUMEDIENE ABDESSAMED', 'ABRAJ INJAZ, TIARET', 160.0, false, '08:00', '20:00', false, NULL, '08h-20h'),
  (10, '2206', 'SARL FAUCON BLEU, Adrar', ARRAY['+213770255264']::text[], NULL, 'Anis dehimi', 'FAUCON BLEU ADRAR', 1160.0, true, NULL, NULL, true, NULL, '24/24 vendredi exclu'),
  (11, NULL, 'GCB DRO, MTBE ARZEW, ORAN', '{}', NULL, NULL, 'GCB ARZEW', 395.0, true, NULL, NULL, false, NULL, '24H/24H'),
  (12, '1863', 'SNC HYDRO TRAV HABIB ET ASSOCIES', ARRAY['+213550851314']::text[], NULL, 'Ahmed allout', 'HYDRO GHARDAIA', 345.0, false, '07:00', '20:00', true, NULL, '07H-20H vendredi exclu'),
  (13, '1956', 'KOUICI ZAKARIA', '{}', NULL, NULL, 'HAD SAHARY DJELFA', 250.0, false, '07:00', '20:00', false, NULL, '07H-20H'),
  (14, NULL, 'SARL BY MOULAY EL HACEN, zone industrielle de DJELFA', '{}', NULL, NULL, 'DJELFA MOLAY EL HACEN', 160.0, false, NULL, '18:00', false, NULL, 'Fermeture 18 h'),
  (15, '2119', 'COSIDER OUVRAGE D''ART PÖLE A83 Client 2119', '{}', NULL, 'Hocine samir', 'M''SILA A83', 340.0, false, '07:00', '22:00', false, NULL, '07H-22H'),
  (16, '2177', 'SARL BELTEK', '{}', NULL, 'Oussama MAHAMMEDI', 'BELTEK NAAMA', 390.0, false, '07:00', '24:00', true, NULL, '07H-00H vendredi exclu'),
  (17, '1846', 'SPA INFRARAIL, HASSI BAHBAH INFRARAIL', ARRAY['+213561670829']::text[], NULL, 'Ahmed allout', 'HASSI BAHBAH', 160.0, false, '07:00', '20:00', false, NULL, '07H-20H'),
  (18, '2203', 'SARL DEBO TRAVAUX,SAIDA', ARRAY['+213560598554']::text[], NULL, 'Oussama MAHAMMEDI', 'SAIDA - DEBO', 232.0, true, NULL, NULL, false, NULL, '24/24'),
  (19, '2211', 'COSIDER OUVRAGE D''ART A 91 TNDOUF', ARRAY['+213655535895']::text[], NULL, 'Hocine samir', 'TINDOUF - A 91', 1306.0, false, '07:00', '24:00', false, NULL, '07H-00H'),
  (20, '2208', 'SARL AZZEDINE ET CHABANE CONSTRUCTION, SIDI NAAMANE', '{}', NULL, 'BOUSETTA BOUMEDIENE ABDESSAMED', 'AZZEDINE ET CHABANE SIDI NAAMANE', 517.0, false, '07:00', '24:00', false, NULL, '07H-00H'),
  (21, '1846', 'INFRARAIL SPA ROUIBA', ARRAY['+213561670829','+213561889913']::text[], NULL, 'Ahmed allout', 'INFRARAIL ROUIBA', 440.0, false, '07:00', '24:00', false, NULL, '07H-00H'),
  (22, '2110', 'BENMOUSSA ABDELKADER, GÉNÉRAL CONCRETE ALGERIA Saida', ARRAY['+213560090444']::text[], NULL, 'Oussama MAHAMMEDI', 'BENMOUSSA ABDELKADER SAIDA', 245.0, false, '07:00', '24:00', true, NULL, '07H-00H vendredi exclu'),
  (23, '2225', 'SPA CSCEC (BOUDOUAOU 2500 LOGTS SITE 2)', ARRAY['+213540603192']::text[], NULL, 'Hocine samir', 'EQUIPE2 BOUDOUAOU - CSCEC', 440.0, NULL, NULL, NULL, NULL, NULL, NULL),
  (24, '1788', 'SARL ASLAN CONSTRUCTION ET COMMERCE, AADL 2500 LOGT BOUDOUAOU', ARRAY['+213771817283']::text[], NULL, 'Hocine samir', 'BOUDOUAOU ASLAN', 440.0, NULL, NULL, NULL, NULL, NULL, NULL),
  (25, '2230', 'GREAT WALL DRILLING COMPANY, greatwall drilling company route Ain amenas , Base TSP IRARA HASSI MESSAOUD OUARGLA', ARRAY['+213660566502']::text[], NULL, 'hamid boussadi', 'GREAT WALL HMD', 635.0, false, NULL, '16:00', true, NULL, '16 h - vendredi exclu'),
  (34, '1646', 'SPA CHIALI SERVICES, EL MENIA CHIALI', '{}', NULL, 'BOUSETTA BOUMEDIENE ABDESSAMED', 'CHIALI EL MENIA', 640.0, NULL, NULL, NULL, NULL, NULL, NULL),
  (26, '2224', 'SPA CSCEC ALGERIE (Boumerdes 2500 LOGTS site05 Equipe 1), BOUDOUAOU', ARRAY['+213561186923','+213559729479']::text[], NULL, 'Hocine samir', 'Equipe 1 BOUDOUAOU - CSCEC', 440.0, false, '07:00', '24:00', false, NULL, '07H-00H'),
  (27, '1945', 'SARL BETON ORAN - SBO, ORAN BETHIOUA SBO', ARRAY['+213555038588']::text[], NULL, 'Oussama MAHAMMEDI', 'BETHIOUA ORAN SBO', 394.0, NULL, NULL, NULL, NULL, NULL, NULL),
  (28, '2230', 'SARL ZCIGC CONSTRUCTION ALGERIE -OUARGLA-, ZCIGC - OUARGLA', ARRAY['+213559366366']::text[], NULL, 'Anis dehimi', 'ZCIGC - OUARGLA', 545.0, false, NULL, '18:00', false, NULL, '18:00'),
  (29, NULL, 'SNC IGAM', '{}', NULL, NULL, 'Aïn Bouchekif', NULL, true, NULL, NULL, false, true, '24H/24, 7 jours/7'),
  (30, NULL, 'COSIDER CANALISATION -Pôle D02-, TLEMCEN', '{}', NULL, NULL, 'Telemcen D02', 590.0, NULL, NULL, NULL, NULL, NULL, NULL),
  (31, NULL, 'cosider ouvrage d''art pôle A 30-01 Boughezoul- Médéa .', ARRAY['+213662084171']::text[], NULL, 'Hocine samir', 'COSIDER / BOUGHEZOULA30-01', 218.0, false, '08:00', '23:00', false, NULL, '08h00 à 23h00'),
  (32, NULL, 'C M H BETON, BOUFARIK, BLIDA', '{}', NULL, NULL, 'BOUFARIK, BLIDA CMH', 383.0, false, '07:00', '24:00', false, NULL, '07H-00H'),
  (33, '2158', 'EURL CECEG ALGERIE', '{}', NULL, NULL, 'EL EULMA', 550.0, true, NULL, NULL, false, true, '24H/24, 7 jours/7'),
  (35, NULL, 'EURL CRCEG ALGERIE', ARRAY['+213672807456']::text[], NULL, NULL, 'GUELMA', 689.0, true, NULL, NULL, true, NULL, '24/24 vendredi exclu'),
  (37, NULL, 'EURL CRCEG ALGERIE', ARRAY['+213672807456']::text[], NULL, NULL, 'JIJEL', 670.0, true, NULL, NULL, true, NULL, '24/24 vendredi exclu'),
  (38, NULL, 'SARL ACTCE LOKMANE Client 2139', '{}', NULL, NULL, 'SOUMAA -BOUFARIK', 420.0, true, NULL, NULL, false, true, '24H/24, 7 jours/7'),
  (39, NULL, 'SARL BETON HAMDAOUI SBH', '{}', NULL, NULL, 'BETON HAMDAOUI', 410.0, false, NULL, '20:00', false, NULL, 'Fermeture 20 h'),
  (36, '1297', 'SARL ELBAYRAK CONSTRUCTION', '{}', NULL, 'BOUSETTA BOUMEDIENE ABDESSAMED', 'Hassi ameur', 420.0, false, NULL, '22:00', false, NULL, 'Fermeture 22 h'),
  (36, '2126', 'SPA SOCIETE DES GRANULATS D''ALGERIE SGA - BPE AIN TEMOUCHENT', ARRAY['+213660205793']::text[], NULL, 'Anis dehimi', 'GRANULATS AIN TEMOUCHENT', 470.0, false, '07:00', '20:00', false, NULL, '07H-20H'),
  (37, '1250', 'BERRARMA MABROUK Laghouat', ARRAY['+213667227009']::text[], NULL, 'Ahmed allout', 'Laghouat BERRARMA MABROUK', 154.0, true, NULL, NULL, true, NULL, '24H-24H vendredi exclu'),
  (38, NULL, 'BENKOUIDER RACHID , BEN KOUIDER MESSAAD, DJELFA', ARRAY['+213661634284']::text[], NULL, 'Ahmed allout', 'BEN KOUIDER MESSAAD, DJELFA', 160.0, false, '08:00', '18:00', false, NULL, '08h a18h'),
  (39, '2157', 'COSIDER CANALISATION POLE L10 NT401 IN SALAH, M’Guiden – Timimoun', ARRAY['+213778862972']::text[], NULL, 'Hocine samir', 'M’Guiden – Timimoun', 815.0, false, NULL, '22:00', false, true, '7/7 a 22 H'),
  (40, '2236', 'SPA COSIDER OUVRAGES D''ART - POLE A 90 - BECHAR', ARRAY['+213779005864']::text[], NULL, 'Hocine samir', 'BECHAR A90', 574.0, false, NULL, '23:00', false, true, '7/7 J FERMITURE 23H00'),
  (41, '2237', 'SPA COSIDER CANALISATION - PÔLE L 12, HASSI MESSAOUD POLE L 12', ARRAY['+213676014332']::text[], NULL, 'Hocine samir', 'HASSI MESSAOUD', 636.0, false, '08:00', '22:00', false, NULL, '8 h a 22 h 6/7 jours'),
  (42, '1660', 'SARL BETOBAG, TABAINET BETOBAG', ARRAY['+213797895355']::text[], NULL, 'Hocine samir', 'TABAINET BETOBAG', 403.0, false, NULL, '23:00', false, true, 'FERMITURE / 23 H00 7/7 J'),
  (43, '1982', 'SARL CHINA HARBOUR ALGERIE, PROJET REALISATION BATIMENT R+2 Marsa elkebir', ARRAY['+213558004908']::text[], NULL, 'Anis dehimi', 'ORAN HARBOUR', 412.0, false, '07:30', '18:00', false, NULL, '07:30 - 18:00 h'),
  (44, NULL, 'COSIDER CANALISATION POLE H 70-Tindouf, TINDOUF', ARRAY['+213661381936']::text[], NULL, 'Hocine samir', 'TINDOUF', 1430.0, false, '08:00', '23:00', false, NULL, '8h a 23 h'),
  (45, NULL, 'EURL CRCEG ALGERIE, PROJET BALADNA', ARRAY['+213561205277']::text[], NULL, 'Anis dehimi', 'ADRAR', 1081.0, false, '08:00', '23:00', false, NULL, '8h à 23h'),
  (46, NULL, 'cosider ouvrage d''art pôle A 30 Boughezoul- Médéa .', ARRAY['+213792726815']::text[], NULL, 'Hocine samir', 'COSIDER / BOUGHEZOULA30', 244.0, false, '08:00', '23:00', false, NULL, '08h00 à 23h00'),
  (47, '2242', 'CHINA STATE CONSTRUCTION ENGINEERING CORPORATION LIMITED CHINE - HADJOUT,CSCEC - PROJET / ETUDE ET REALISATION D4UN PROJET D''INFRASTRUCTURE', ARRAY['+213556787763','+213770751871']::text[], NULL, 'Hocine samir', 'CSCEC HADJOUT', 394.0, false, '08:00', '19:00', false, true, '7/7 du 08H a 19 H'),
  (48, '1297', 'SARL ELBAYRAK CONSTRUCTION, MESSERGHIN', ARRAY['+213669648820']::text[], NULL, 'BOUSETTA BOUMEDIENE ABDESSAMED', 'MESSERGHIN', 414.0, false, '07:00', '20:00', false, NULL, '7h-20h'),
  (49, NULL, 'CSCEC TRAVAUX DE RÉALISATION D’UNE UNITÉ SAHARIENNE/TIMIMOUNE/3°RM ZONE A, Aougrout Timimoun', ARRAY['+213540812368']::text[], NULL, 'Hocine samir', 'Aougrout Timimoun', NULL, false, '08:00', '23:00', false, true, '7/7 du 08 / a 23 h'),
  (50, '1297', 'SARL ELBAYRAK CONSTRUCTION AIN LAHDJER', ARRAY['+213799301335']::text[], NULL, 'BOUSETTA BOUMEDIENE ABDESSAMED', 'SAIDA AIN LAHDJER', NULL, false, '08:00', '20:00', false, NULL, '08H-20H'),
  (NULL, NULL, 'SPA ATLAS GENIE CIVIL COMPANY, BEJAIA', '{}', NULL, 'BOUSETTA BOUMEDIENE ABDESSAMED', 'BEJAIA', NULL, false, '08:00', '20:00', false, NULL, '8h-20h'),
  (1, NULL, 'SARL TIMBAT, TIMIMOUNE', '{}', NULL, NULL, 'TIMIMOUNE', 810.0, false, '07:00', '24:00', false, NULL, '07H-00H'),
  (2, NULL, 'SARL SKN INTERNATIONAL - BENI TAMOU', '{}', NULL, NULL, 'BENI TAMOU', 370.0, true, NULL, NULL, true, NULL, '24H/24H vendredi exclu'),
  (5, '1735', 'SARL ABRAJ INJAZ', '{}', NULL, 'BOUSETTA BOUMEDIENE ABDESSAMED', 'AADL MEDEA', 303.0, true, NULL, NULL, false, true, '24H/24, 7 jours/7'),
  (3, '1788', 'SARL ASLAN CONSTRUCTION ET COMMERCE', '{}', NULL, 'Hocine samir', 'MEFTAH BLIDA', 420.0, false, NULL, '22:00', true, NULL, 'Fermeture 22 h vendredi exclu'),
  (4, '2129', 'COSIDER OUVRAGE D''ART POLE A76-01', '{}', NULL, 'Hocine samir', 'BENI ABBES /BECHAR A76-01', 900.0, true, NULL, NULL, false, true, '24H/24, 7 jours/7'),
  (6, '2130', 'COSIDER OUVRAGE D''ART POLE A 76', ARRAY['+213660614222','+213669197058']::text[], NULL, 'Hocine samir', 'A76 EL EUGLA, BECHAR', 800.0, false, '07:00', '24:00', false, NULL, '07H-00H'),
  (7, NULL, 'COSIDER OURVRAGE D''ART A71', '{}', NULL, 'Hocine samir', 'ABADLA, BECHAR A71', 700.0, true, NULL, NULL, false, true, '24H/24, 7 jours/7'),
  (11, NULL, 'SARL CHINA HARBOUR ALGERIE CHEC Client 1982', '{}', NULL, NULL, 'PORT ARZEW', 420.0, false, NULL, '16:00', true, NULL, 'Fermeture 16 h vendredi exclu'),
  (12, NULL, 'SARL ASLAN CONSTRUCTION ET COMMERCE Client 1788', '{}', NULL, NULL, 'RAHMANIA', 395.0, true, NULL, NULL, false, true, '24H/24, 7 jours/7'),
  (13, NULL, 'GCB DRC', '{}', NULL, NULL, 'Si Mustapha - BOUMERDES', 450.0, false, NULL, '21:00', false, NULL, 'Fermeture 21 h'),
  (9, NULL, 'SARL Houria Services', '{}', NULL, NULL, 'AFLOU - Houria', 50.0, NULL, NULL, NULL, NULL, NULL, NULL),
  (14, NULL, 'DISTRIBUTION DAHEL ABDELKRIM', '{}', NULL, NULL, 'TMOUCHANT', 480.0, NULL, NULL, NULL, NULL, NULL, NULL),
  (10, NULL, 'Privé Distribution (NAJI)', '{}', NULL, NULL, 'BOUMERDES', 452.0, NULL, NULL, NULL, NULL, NULL, NULL),
  (8, NULL, 'Privé Distribution (NAJI)', '{}', NULL, NULL, 'AFLOU - BOUDJELTI', 50.0, NULL, NULL, NULL, NULL, NULL, NULL);

-- Link to the sites that already exist by normalised name: upper-cased,
-- accents folded (Aïn/AIN, PÔLE/POLE, R'mel/R MEL) and every run of
-- punctuation collapsed to one space, so "TISEMSILET - GBC" meets
-- "TISEMSILET  GBC". unaccent is not installed on this project, hence
-- translate() rather than the extension.
UPDATE public.clients c
   SET site_id = s.id
  FROM public.construction_sites s
 WHERE public.norm_site_name(c.site_name) = public.norm_site_name(s.name)
   AND c.site_id IS NULL;
