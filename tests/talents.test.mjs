import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const snapshot = JSON.parse(
  fs.readFileSync(
    new URL('../data/operators-autochess.json', import.meta.url),
    'utf8',
  ),
);
const operatorById = new Map(
  snapshot.operators.map((operator) => [operator.id, operator]),
);

function maxTalent(operatorId, name) {
  return operatorById
    .get(operatorId)
    .talents.filter((talent) => talent.name === name)
    .sort((a, b) => a.phase - b.phase || a.level - b.level)
    .at(-1);
}

test('all local autochess operator talent arrays are present', () => {
  assert.equal(snapshot.source.dataSource, 'local-game-tables');
  assert.equal(snapshot.operators.length, 143);
  assert.equal(
    snapshot.operators.every((operator) => Array.isArray(operator.talents)),
    true,
  );
});

test('all local skill levels retain source templates and Blackboard data', () => {
  const levels = snapshot.operators.flatMap((operator) =>
    operator.skills.flatMap((skill) => Object.values(skill.levels)),
  );

  assert.equal(levels.length > 0, true);
  assert.equal(
    levels.every(
      (level) =>
        typeof level.descriptionTemplate === 'string' &&
        level.blackboard &&
        typeof level.blackboard === 'object',
    ),
    true,
  );
  assert.equal(
    snapshot.operators
      .flatMap((operator) => operator.skills)
      .every((skill) => skill.skillId),
    true,
  );
});

test('Ember talents expose attack and deployment SP effects', () => {
  const attack = maxTalent('char_180_amgoat', '炎息');
  const initialSp = maxTalent('char_180_amgoat', '乱火');

  assert.equal(attack.condition, '精英2 Lv1');
  assert.equal(attack.effects.attackBonus, 16);
  assert.equal(attack.conditional, true);
  assert.equal(initialSp.effects.initialSp, 14.5);
  assert.equal(initialSp.mechanics.includes('random'), true);
  assert.equal(initialSp.mechanics.includes('deployment'), true);
});

test('Logos talents expose expected extra damage and resistance effects', () => {
  const extra = maxTalent('char_4133_logos', '语汇演化');
  const debuff = maxTalent('char_4133_logos', '剜魂具辞');

  assert.equal(extra.effects.extraDamageMultiplier, 0.26);
  assert.equal(extra.mechanics.includes('probability'), true);
  assert.equal(debuff.effects.resistanceIgnore, 10);
  assert.equal(debuff.effects.flatHitDamage, 165);
});

test('Eunectes and special operator talents remain classified', () => {
  const eunectes = maxTalent('char_416_zumama', '勇冠三军');
  const special = operatorById.get('char_618_acrbot');

  assert.equal(eunectes.effects.damageMultiplier, 1.17);
  assert.equal(eunectes.mechanics.includes('conditionalHp'), true);
  assert.equal(special.talents.length >= 2, true);
  assert.equal(
    special.talents.every((talent) => 'blackboard' in talent),
    true,
  );
});

test('multiple unrelated operators retain raw talent blackboards', () => {
  for (const operatorId of [
    'char_1051_headb2',
    'char_4193_lemuen',
    'char_4064_mlynar',
  ]) {
    const operator = operatorById.get(operatorId);
    assert.equal(Boolean(operator), true);
    assert.equal(operator.talents.length > 0, true);
    assert.equal(
      operator.talents.some(
        (talent) =>
          talent.blackboard &&
          Object.keys(talent.blackboard).length > 0,
      ),
      true,
    );
  }
});
