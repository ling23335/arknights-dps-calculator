import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import '../src/calc.js';
import { buildSkillAudit } from '../scripts/audit-skill-data.mjs';

const audit = buildSkillAudit();
const operators = JSON.parse(
  fs.readFileSync(
    new URL('../data/operators-autochess.json', import.meta.url),
    'utf8',
  ),
).operators;

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

test('Heyak retains base hit plus extra hit and nine-shot values', () => {
  const heyak = operators.find((operator) => operator.id === 'char_4027_heyak');
  const first = heyak.skills.find((skill) => skill.name === '但为求索');
  const second = heyak.skills.find((skill) => skill.name === '群星逶迤');
  const firstLevel = first.levels.M3;
  const secondLevel = second.levels.M3;
  const firstHints = globalThis.ArkCalc.estimateSkillHints(
    firstLevel.description,
    firstLevel.blackboard,
    firstLevel.maxChargeTime,
  );
  const secondHints = globalThis.ArkCalc.estimateSkillHints(
    secondLevel.description,
    secondLevel.blackboard,
    secondLevel.maxChargeTime,
  );

  assert.deepEqual(
    [firstHints.attackMultiplier, firstHints.charges, firstHints.skillHits],
    [4, 3, 1],
  );
  assert.deepEqual(
    [secondHints.attackMultiplier, secondHints.skillHits],
    [0.45, 9],
  );
});
