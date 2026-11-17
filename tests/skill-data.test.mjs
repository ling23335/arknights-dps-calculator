import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSkillAudit } from '../scripts/audit-skill-data.mjs';

const audit = buildSkillAudit();

test('all local skills retain unpacked source data', () => {
  assert.equal(audit.operatorCount, 143);
  assert.equal(audit.skillCount, 360);
  assert.deepEqual(audit.missingData, []);
});

test('all local skills produce finite frame simulation values', () => {
  assert.deepEqual(audit.invalidResults, []);
  assert.equal(audit.chargeCount >= 34, true);
  assert.equal(audit.multiHitCount >= 20, true);
});
