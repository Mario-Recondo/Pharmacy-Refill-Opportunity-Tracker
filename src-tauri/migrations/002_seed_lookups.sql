-- Seed vocabularies, taken verbatim from the technician's Google Sheet
-- (see Design_docs screenshots). All values editable in Settings; hex colors
-- are first-pass approximations of the sheet's palette, also editable.

-- Insurances, in the sheet dropdown's order. Color groups per design doc §4.3.
-- 'LP' is intentionally NOT seeded (open question: likely a workflow state, not a payer).
INSERT INTO insurances (name, color, is_medicare_medicaid, sort_order) VALUES
  ('Anthem',                          '#bbdefb', 0, 10),
  ('BC/BS - Alabama',                 '#bbdefb', 0, 20),
  ('BC/BS - Federal Employees',       '#bbdefb', 0, 30),
  ('BC/BS - Florida',                 '#bbdefb', 0, 40),
  ('BC/BS - Texas',                   '#bbdefb', 0, 50),
  ('Horizon BC/BS NJ',                '#bbdefb', 0, 60),
  ('Cigna',                           '#e1bee7', 0, 70),
  ('Cigna - Disclosed Rx',            '#e1bee7', 0, 80),
  ('Cigna Great West',                '#e1bee7', 0, 90),
  ('Express Scripts',                 '#e1bee7', 0, 100),
  ('Aet - St Thomas',                 '#ffccbc', 0, 110),
  ('Aet - UMIA',                      '#ffccbc', 0, 120),
  ('CVS Caremark',                    '#ffccbc', 0, 130),
  ('Oscar',                           '#ffccbc', 0, 140),
  ('Catalyst Rx',                     '#ffcc80', 0, 150),
  ('Optum Rx',                        '#ffcc80', 0, 160),
  ('United Healthcare',               '#ffcc80', 0, 170),
  ('Capital Rx',                      '#c8e6c9', 0, 180),
  ('Maxorplus Super',                 '#c8e6c9', 0, 190),
  ('Proact',                          '#c8e6c9', 0, 200),
  ('RightWay',                        '#c8e6c9', 0, 210),
  ('PDMI',                            '#c8e6c9', 0, 220),
  ('Nhp Open Access',                 '#b3e5fc', 1, 230),
  ('Amerigroup',                      '#b3e5fc', 1, 240),
  ('Caremore-Rx',                     '#b3e5fc', 1, 250),
  ('Simply FL Medicaid (ignenioRx)',  '#b3e5fc', 1, 260),
  ('Optum Medicaid',                  '#b3e5fc', 1, 270),
  ('Envision Rx Plus',                '#b3e5fc', 1, 280),
  ('Mcaidadv',                        '#b3e5fc', 1, 290),
  ('United Pt D',                     '#b3e5fc', 1, 300),
  ('Molina',                          '#b3e5fc', 1, 310),
  ('BC/BS - Part D',                  '#b3e5fc', 1, 320),
  ('Amerihealth Caritas Next',        '#b3e5fc', 1, 330),
  ('Wausau',                          '#fff9c4', 0, 340),
  ('Coupon Only',                     '#795548', 0, 350),
  ('Cashed Out',                      '#2e7d32', 0, 360);

-- Refill notes, in the sheet dropdown's order (number prefixes dropped; sort_order replaces them)
INSERT INTO refill_notes (name, color, meaning, sort_order) VALUES
  ('Discontinued',     '#1565c0', 'Patient or prescriber ended therapy; no further fills expected', 10),
  ('Nimble Link',      '#c8e6c9', 'Payment link sent to patient',                                   20),
  ('Call Pt',          '#a5d6a7', 'Phone call (typically 65+ patients not comfortable with links)', 30),
  ('Faxed for Script', '#90caf9', 'Fax sent to MD for a new Rx when refills exhausted',             40),
  ('Fax not sent',     '#1976d2', 'Fax suppressed to avoid a duplicate fax',                        50),
  ('TOO SOON TO FILL', '#ef9a9a', 'Too early to fill; retry on/after the allowable date',           60),
  ('INS Issue',        '#81d4fa', 'Insurance problem pending resolution',                           70),
  ('PA Req',           '#ffccbc', 'Prior authorization required',                                   80),
  ('TRY AGAIN LATER',  '#c62828', 'Could not reach patient; retry',                                 90),
  ('NO Per Pt',        '#9fa8da', 'Patient wants verbal authorization; check patient notes',        100);

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
