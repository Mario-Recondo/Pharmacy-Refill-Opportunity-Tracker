-- Seed vocabularies, taken verbatim from the technician's Google Sheet
-- (see Design_docs screenshots). All values editable in Settings; hex colors
-- are first-pass approximations of the sheet's palette, also editable.

-- Master-brand groups per the technician's Insurance_grouping.md (2026-07-14).
-- Medicare/Medicaid are NOT groups — they are designation flags on the plans.
-- Independent PBMs has no logo yet (open question); its plans render plain.
INSERT INTO insurance_groups (id, name, logo, sort_order) VALUES
  (1,  'Blue Cross Blue Shield',          'bcbs',               10),
  (2,  'CVS Health',                      'cvs-health',         20),
  (3,  'Elevance Health',                 'elevance-health',    30),
  (4,  'UnitedHealth Group',              'unitedhealth-group', 40),
  (5,  'The Cigna Group',                 'cigna-group',        50),
  (6,  'Oscar Health',                    'oscar-health',       60),
  (7,  'MedImpact Healthcare Systems',    'medimpact',          70),
  (8,  'Molina Healthcare',               'molina-healthcare',  80),
  (9,  'AmeriHealth Caritas',             'amerihealth',        90),
  (10, 'Independent / Stand-Alone PBMs',  NULL,                 100);

-- Insurances, in the sheet dropdown's order. Group + designations per
-- Insurance_grouping.md; NULL group = ungrouped (Aet - UMIA and Wausau await
-- the technician's placement; Coupon Only / Cashed Out are workflow states).
-- 'LP' is intentionally NOT seeded (technician: disregard entirely).
INSERT INTO insurances (name, group_id, is_medicare, is_medicaid, sort_order) VALUES
  ('Anthem',                          3,    0, 0, 10),
  ('BC/BS - Alabama',                 1,    0, 0, 20),
  ('BC/BS - Federal Employees',       1,    0, 0, 30),
  ('BC/BS - Florida',                 1,    0, 0, 40),
  ('BC/BS - Texas',                   1,    0, 0, 50),
  ('Horizon BC/BS NJ',                1,    0, 0, 60),
  ('Cigna',                           5,    0, 0, 70),
  ('Cigna - Disclosed Rx',            5,    0, 0, 80),
  ('Cigna Great West',                5,    0, 0, 90),
  ('Express Scripts',                 5,    0, 0, 100),
  ('Aet - St Thomas',                 2,    0, 0, 110),
  ('Aet - UMIA',                      NULL, 0, 0, 120),
  ('CVS Caremark',                    2,    0, 0, 130),
  ('Oscar',                           6,    0, 0, 140),
  ('Catalyst Rx',                     10,   0, 0, 150),
  ('Optum Rx',                        4,    0, 0, 160),
  ('United Healthcare',               4,    0, 0, 170),
  ('Capital Rx',                      10,   0, 0, 180),
  ('Maxorplus Super',                 10,   0, 0, 190),
  ('Proact',                          10,   0, 0, 200),
  ('RightWay',                        10,   0, 0, 210),
  ('PDMI',                            10,   0, 0, 220),
  ('Nhp Open Access',                 4,    0, 0, 230),
  ('Amerigroup',                      3,    0, 1, 240),
  ('Caremore-Rx',                     10,   0, 0, 250),
  ('Simply FL Medicaid (ignenioRx)',  3,    0, 1, 260),
  ('Optum Medicaid',                  4,    0, 1, 270),
  ('Envision Rx Plus',                7,    1, 0, 280),
  ('Mcaidadv',                        NULL, 1, 0, 290),
  ('United Pt D',                     4,    1, 0, 300),
  ('Molina',                          8,    1, 1, 310),
  ('BC/BS - Part D',                  1,    1, 0, 320),
  ('Amerihealth Caritas Next',        9,    1, 1, 330),
  ('Wausau',                          NULL, 0, 0, 340),
  ('Coupon Only',                     NULL, 0, 0, 350),
  ('Cashed Out',                      NULL, 0, 0, 360);

-- Refill notes, in the sheet dropdown's order (number prefixes dropped; sort_order replaces them).
-- Behavior flags (not name matching): allows_call_note enables the call-note cell,
-- shows_age_counter renders the days-since-set counter in the month grid.
INSERT INTO refill_notes (name, color, meaning, allows_call_note, shows_age_counter, sort_order) VALUES
  ('Discontinued',     '#1565c0', 'Patient or prescriber ended therapy; no further fills expected', 0, 0, 10),
  ('Nimble Link',      '#c8e6c9', 'Payment link sent to patient',                                   1, 1, 20),
  ('Call Pt',          '#a5d6a7', 'Phone call (typically 65+ patients not comfortable with links)', 1, 0, 30),
  ('Faxed for Script', '#90caf9', 'Fax sent to MD for a new Rx when refills exhausted',             0, 0, 40),
  ('Fax not sent',     '#1976d2', 'Fax suppressed to avoid a duplicate fax',                        0, 0, 50),
  ('TOO SOON TO FILL', '#ef9a9a', 'Too early to fill; retry on/after the allowable date',           0, 0, 60),
  ('INS Issue',        '#81d4fa', 'Insurance problem pending resolution',                           0, 0, 70),
  ('PA Req',           '#ffccbc', 'Prior authorization required',                                   0, 0, 80),
  ('TRY AGAIN LATER',  '#c62828', 'Could not reach patient; retry',                                 0, 0, 90),
  ('NO Per Pt',        '#9fa8da', 'Patient wants verbal authorization; check patient notes',        0, 0, 100);

-- Call notes, in the sheet dropdown's order
INSERT INTO call_notes (name, color, meaning, sort_order) VALUES
  ('N/A',                '#e0e0e0', '',                                                                  10),
  ('D/S',                '#c5cae9', 'Delivery scheduled by tech via phone',                              20),
  ('P/U',                '#d1c4e9', 'Pickup scheduled',                                                  30),
  ('Nimble IC',          '#c8e6c9', 'Paid via link, wants delivery',                                     40),
  ('Nimble PickUp',      '#dcedc8', 'Paid via link, will pick up',                                       50),
  ('LVM+RSL',            '#f0f4c3', 'Voicemail left, link re-sent',                                      60),
  ('D/S+RSL',            '#b2dfdb', 'Patient will pay via Nimble later, link re-sent',                   70),
  ('VMB FULL+RSL',       '#ffe0b2', 'Voicemail box full, link sent',                                     80),
  ('VMB NOT SET UP+RSL', '#ffccbc', 'No voicemail set up, link sent',                                    90),
  ('POH PER PT+WCB',     '#ffab91', 'Order on hold - patient does not want it right now, will call back', 100),
  ('PT WCB+RSL',         '#ffcc80', 'Patient will call back for payment; Nimble link sent just in case', 110);

-- Defaults (design doc §4.3 settings + §6 Opportunities seeds)
INSERT INTO settings (key, value) VALUES
  ('alert_lookahead_days', '3'),
  ('alert_min_profit',     '50'),
  ('copay_tiers',          '[{"max":0,"color":"#d4e157"},{"max":29.99,"color":"#bbdefb"},{"max":99.99,"color":"#e1bee7"},{"max":300,"color":"#f8bbd0"},{"max":null,"color":"#e57373"}]'),
  ('status_colors',        '{"Pending":"#eeeeee","Checked Out":"#fdd835","MISSED":"#1a237e"}');
