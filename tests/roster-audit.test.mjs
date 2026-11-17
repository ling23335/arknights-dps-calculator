import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRosterAudit } from '../scripts/audit-roster.mjs';

const audit = buildRosterAudit();

test('all 143 autochess operators have a usable elite-two combat profile', () => {
  assert.equal(audit.operatorCount, 143);
  assert.deepEqual(audit.missingOperators, []);
  assert.deepEqual(Object.keys(audit.namedSamples).length, 6);
  assert.equal(
    Object.values(audit.namedSamples).every(Boolean),
    true,
  );
});

test('all relevant autochess traits expose parsed numeric effects', () => {
  assert.equal(audit.traitCount, 143);
  assert.deepEqual(audit.unsupportedRelevantTraits, []);
  assert.equal(
    audit.parsedTraitEffects.some(
      ({ evaluation }) => evaluation.effects.spPerSecond > 0,
    ),
    true,
  );
  assert.equal(
    audit.parsedTraitEffects.some(
      ({ evaluation }) => evaluation.effects.aspd > 0,
    ),
    true,
  );
  assert.equal(
    audit.parsedTraitEffects.some(
      ({ evaluation }) => evaluation.effects.attackBonus > 0,
    ),
    true,
  );
});

test('charge skills are present across multiple operators and professions', () => {
  assert.equal(audit.chargeSkills.length >= 10, true);
  assert.equal(audit.invalidChargeSkills.length, 0);
  assert.equal(
    new Set(
      audit.chargeSkills.map((skill) => skill.operatorId),
    ).size >= 5,
    true,
  );
  assert.equal(
    new Set(
      audit.chargeSkills.map((skill) => skill.profession),
    ).size >= 2,
    true,
  );
});

test('local modules are linked to known operators with valid levels', () => {
  assert.equal(audit.moduleCount >= 100, true);
  assert.equal(audit.moduleCharacterCount >= 100, true);
  assert.deepEqual(audit.unknownModuleOwners, []);
  assert.deepEqual(audit.invalidModuleLevels, []);
});

test('conditional and complex talent risks are explicitly classified', () => {
  assert.equal(audit.supportedTalents > 0, true);
  assert.equal(audit.conditionalTalents > 0, true);
  assert.equal(
    Object.values(audit.talentMechanics).some(
      (count) => count > 0,
    ),
    true,
  );
  assert.equal(
    Object.values(audit.skillRiskCounts).some(
      (count) => count > 0,
    ),
    true,
  );
});
