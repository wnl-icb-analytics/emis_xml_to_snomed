import assert from 'node:assert/strict';
import test from 'node:test';
import { explainAction, explainEdit, explainOperator, isRollover, rollYear } from './change-notes';

test('rollYear moves every year on by one', () => {
  assert.equal(rollYear('Date on or after 01/04/2025'), 'Date on or after 01/04/2026');
  assert.equal(rollYear('[CR1] 2025-26 PCN Outcome'), '[CR1] 2026-27 PCN Outcome');
  assert.equal(rollYear('[rICS_HTN_21NOBPAPR25] NO record of BP Since Apr2025'), '[rICS_HTN_21NOBPAPR26] NO record of BP Since Apr2026');
  assert.equal(rollYear('Since Apr 25- %'), 'Since Apr 26- %');
});

test('a rollover is routine only when nothing else changed', () => {
  assert.ok(isRollover('Date strictly after 01/04/2025', 'Date strictly after 01/04/2026'));
  assert.ok(!isRollover('numeric value <= 140', 'numeric value < 140'));
  assert.ok(!isRollover('Since Apr 25- % on HTN REG', 'Since Apr 26- %on HTN REG'));
  // A threshold of 25 is not a year
  assert.ok(!isRollover('BMI >= 25', 'BMI >= 26'));
  // Nor is one that looks like a year
  assert.ok(!isRollover('Numeric value >= 2000', 'Numeric value >= 2001'));
  assert.ok(isRollover('QOF 2025-26', 'QOF 2026-27'));
  assert.ok(isRollover('FY2025 PCN', 'FY2026 PCN'));
  // Names and folders may carry a bare year
  assert.ok(!isRollover('QOF 2025', 'QOF 2026'));
  assert.ok(isRollover('QOF 2025', 'QOF 2026', true));
});

test('explainEdit names common rule changes', () => {
  assert.equal(explainEdit('numeric value >= 1 AND <= 90', 'numeric value >= 1 AND < 90'), 'Boundary now exclusive: exactly 90 no longer counts');
  assert.equal(explainEdit('numeric value <= 90', 'numeric value < 90', true), 'Boundary now exclusive: a value exactly on the threshold no longer counts');
  assert.equal(explainEdit('numeric value < 140', 'numeric value < 150'), 'Threshold raised from 140 to 150');
  assert.equal(
    explainEdit('Date strictly after 12 months before the search date', 'Date on or after 12 months before the search date'),
    'Window now includes its boundary day'
  );
  assert.equal(explainEdit('Date on or after 1 year before the search date', 'Date on or after 2 years before the search date'), 'Look-back widened from 1 year to 2 years');
  // An upper bound moved further back leaves fewer records
  assert.equal(explainEdit('Date on or before 6 months before the search date', 'Date on or before 12 months before the search date'), 'Look-back narrowed from 6 months to 12 months');
  assert.equal(explainEdit('Date on or after 6 months before the search date', 'Date on or before 12 months before the search date'), undefined);
  assert.equal(explainEdit('Date on or after 01/04/2025', 'Date on or after 01/04/2026'), 'Moved on a year');
  assert.equal(explainEdit('Keep the latest 1 by date', 'Keep the earliest 1 by date'), 'Now uses the earliest record instead of the latest');
  assert.equal(explainEdit('Code in COPD_COD', 'Code in COPDDIAG_COD'), 'Now uses COPDDIAG_COD instead of COPD_COD');
  assert.equal(explainEdit('Course status: Current', 'Course status: Past'), undefined);
});

test('rule actions and operators read as outcomes', () => {
  assert.equal(explainAction('fail', 'SELECT', 'NEXT'), "Patients who don't match now go on to the next rule (previously they were included)");
  assert.equal(explainOperator('AND', 'OR'), 'Now matches if any criterion is met (previously all had to be)');
});
