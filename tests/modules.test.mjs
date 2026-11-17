import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const modules = JSON.parse(
  fs.readFileSync(
    new URL('../data/autochess-modules.json', import.meta.url),
    'utf8',
  ),
);
const operators = JSON.parse(
  fs.readFileSync(
    new URL('../data/operators-autochess.json', import.meta.url),
    'utf8',
  ),
);
const operatorIds = new Set(
  operators.operators.map((operator) => operator.id),
);

test('local module snapshot is complete and belongs to autochess operators', () => {
  assert.equal(modules.source.dataSource, 'local-game-tables');
  assert.equal(modules.moduleCount, 205);
  assert.equal(modules.characterCount, 138);
  assert.equal(
    Object.keys(modules.modulesByCharId).every((charId) =>
      operatorIds.has(charId),
    ),
    true,
  );
  assert.equal(
    Object.values(modules.modulesByCharId)
      .flat()
      .every(
        (module) =>
          module.levels.length === 3 &&
          module.name &&
          module.id,
      ),
    true,
  );
});

test('Ember modules include local stats and trait override', () => {
  const rows = modules.modulesByCharId.char_180_amgoat;
  const xModule = rows.find(
    (module) => module.id === 'uniequip_002_amgoat',
  );

  assert.equal(rows.length, 2);
  assert.equal(xModule.attack, 65);
  assert.equal(xModule.hp, 180);
  assert.equal(xModule.trait.includes('无视目标10点法术抗性'), true);
  assert.equal(xModule.upgradedTalent.includes('攻击力+24%'), true);
});

test('Logos modules retain talent probability and Blackboard', () => {
  const rows = modules.modulesByCharId.char_4133_logos;
  const module = rows.find(
    (entry) => entry.id === 'uniequip_002_logos',
  );

  assert.equal(rows.length, 2);
  assert.equal(module.attack, 67);
  assert.equal(module.hp, 170);
  assert.equal(
    module.talents.some(
      (talent) =>
        talent.blackboard.prob === 0.6 &&
        talent.blackboard.atk_scale === 0.65,
    ),
    true,
  );
});
