import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  extractAutomaticStats,
  stripGameMarkup,
} from '../scripts/reference-data.mjs';
import {
  applyUltimateEnemyStats,
  enrichEnemySnapshot,
} from '../scripts/ultimate-enemies.mjs';

test('game rich text is reduced to readable effect text', () => {
  assert.equal(
    stripGameMarkup(
      '【炎国短刀】\\n<@autochess.dgreen>装备效果</>：攻击力<@ba.vup>+5%</>',
    ),
    '【炎国短刀】\n装备效果：攻击力+5%',
  );
});

test('recognized equipment parameters become DPS modifiers', () => {
  assert.deepEqual(
    extractAutomaticStats([
      {
        Blackboard: {
          atk: 0.25,
          attack_speed: 30,
          def_penetrate: 0.3,
          magic_resist_penetrate: 0.2,
          sp_cost_scale: 0.8,
        },
      },
    ]),
    {
      attackBonus: 25,
      aspd: 30,
      defensePenetration: 0.3,
      resistancePenetration: 0.2,
      spCostMultiplier: 0.8,
    },
  );
});

test('conditional stack parameters are not silently treated as always active', () => {
  assert.deepEqual(
    extractAutomaticStats([
      { Blackboard: { atk_per_cnt: 0.1, max_hp_per_cnt: 0.1 } },
    ]),
    {},
  );
});

test('local equipment and command snapshots are complete and searchable', () => {
  const equipment = JSON.parse(
    fs.readFileSync(
      new URL('../data/equipment.json', import.meta.url),
      'utf8',
    ),
  );
  const commands = JSON.parse(
    fs.readFileSync(
      new URL('../data/commands.json', import.meta.url),
      'utf8',
    ),
  );

  assert.equal(equipment.equipmentCount, equipment.equipment.length);
  assert.equal(equipment.equipment.length, 116);
  assert.equal(commands.commandCount, commands.commands.length);
  assert.equal(commands.commands.length, 74);
  assert.equal(
    [...equipment.equipment, ...commands.commands].every(
      (item) => item.name && item.description,
    ),
    true,
  );
  assert.deepEqual(
    equipment.equipment.find(
      (item) => item.id === 'chess_item_3_06_e_a',
    ).autoStats,
    { attackBonus: 40, aspd: -10 },
  );
});

test('ultimate enemy snapshot applies the exact V3_1 mode factors', () => {
  const snapshot = JSON.parse(
    fs.readFileSync(
      new URL('../data/enemies.json', import.meta.url),
      'utf8',
    ),
  );
  const enemy = snapshot.enemies.find(
    (item) => item.enemyId === 'enemy_9013_acstmk',
  );

  assert.equal(snapshot.ultimateMode.id, 'mode_multi_abyss');
  assert.equal(snapshot.ultimateMode.name, '终极模拟');
  assert.equal(enemy.hp, 3940000);
  assert.equal(enemy.attack, 4875);
  assert.equal(enemy.defense, 4500);
  assert.equal(enemy.resistance, 75);
  assert.equal(enemy.baseDefense, 1000);
});

test('multiplayer boss base hp has no player-count table entry', () => {
  const snapshot = JSON.parse(
    fs.readFileSync(
      new URL('../data/enemies.json', import.meta.url),
      'utf8',
    ),
  );
  const activity = JSON.parse(
    fs.readFileSync(snapshot.source.gameData, 'utf8'),
  );
  const season =
    activity.Activity.Autochess.act3autochess[0].V3_1;
  const blood = season.BossInfoDict.boss_1.BloodDataDict;

  assert.equal(blood.mode_multi_abyss, 3940000);
  assert.equal(blood.mode_single_20, 3940000);
  assert.equal(
    Object.keys(blood).some((key) => /player|member|room/i.test(key)),
    false,
  );
});

test('ultimate enemy snapshot retains local special mechanics', () => {
  const snapshot = JSON.parse(
    fs.readFileSync(
      new URL('../data/enemies.json', import.meta.url),
      'utf8',
    ),
  );
  const enemy = snapshot.enemies.find(
    (item) => item.enemyId === 'enemy_9013_acstmk',
  );
  const database = JSON.parse(
    fs.readFileSync(snapshot.source.enemyDatabase, 'utf8'),
  );
  const activity = JSON.parse(
    fs.readFileSync(snapshot.source.gameData, 'utf8'),
  );
  const enriched = enrichEnemySnapshot(snapshot, database, activity);
  const restoredEnemies = applyUltimateEnemyStats(
    enriched,
    activity,
  ).enemies;
  const restored = restoredEnemies.find(
    (item) => item.enemyId === enemy.enemyId,
  );

  assert.equal(restored.description.includes('蒸汽甲胄'), true);
  assert.equal(restored.tags.includes('machine'), true);
  assert.equal(restored.massLevel, 10);
  assert.equal(restored.moveSpeed, 0.1);
  assert.equal(restored.immunities.includes('StunImmune'), true);
  assert.equal(restored.immunities.includes('FrozenImmune'), true);
  assert.equal(restored.skills.length, 2);
  assert.equal(restored.attributes.MaxHp, 600000);
  assert.equal(restored.typeName, null);
  assert.equal(typeof restored.physicalHitRateDefined, 'boolean');
  assert.equal(typeof restored.magicalHitRateDefined, 'boolean');
  assert.equal(
    enriched.enemies.find((item) => item.specialType === 'CRITIC')
      ?.typeName,
    '特训敌人·致命',
  );
  assert.equal(
    enriched.enemies.find((item) => item.specialType === 'INVISIBLE')
      ?.typeName,
    '特训敌人·隐匿',
  );
  const mirrorEye = restoredEnemies.find(
    (item) => item.enemyId === 'enemy_9039_acrefm',
  );
  const mirrorMembrane = restoredEnemies.find(
    (item) => item.enemyId === 'enemy_9011_acrefr',
  );
  assert.equal(mirrorEye.resistance, 70);
  assert.equal(mirrorEye.refraction.attackSpeedPenalty, -50);
  assert.equal(mirrorEye.refraction.duration, 3);
  assert.equal(mirrorMembrane.resistance, 70);
  assert.equal(mirrorMembrane.hp, 54000);
  assert.equal(mirrorMembrane.refraction.hpBonus, 1);
});

test('autochess character traits include Ember SP recovery', () => {
  const snapshot = JSON.parse(
    fs.readFileSync(
      new URL('../data/autochess-traits.json', import.meta.url),
      'utf8',
    ),
  );
  const ember = snapshot.traits.find(
    (trait) => trait.charId === 'char_180_amgoat',
  );

  assert.equal(snapshot.traitCount, snapshot.traits.length);
  assert.equal(snapshot.traitCount >= 100, true);
  assert.equal(ember.bondIds.includes('lethaniaShip'), true);
  assert.equal(ember.bondIds.includes('arcaneShip'), true);
  assert.equal(ember.description.includes('技力自然回复速度+0.02/秒'), true);
});

test('autochess operator snapshot contains only eligible operators and the special operator', () => {
  const operators = JSON.parse(
    fs.readFileSync(
      new URL('../data/operators-autochess.json', import.meta.url),
      'utf8',
    ),
  );
  const traits = JSON.parse(
    fs.readFileSync(
      new URL('../data/autochess-traits.json', import.meta.url),
      'utf8',
    ),
  );
  const ids = new Set(operators.operators.map((operator) => operator.id));

  assert.equal(operators.operatorCount, operators.operators.length);
  assert.equal(operators.operatorCount, 143);
  assert.equal(
    traits.traits.every((trait) => ids.has(trait.charId)),
    true,
  );
  assert.equal(ids.has('char_618_acrbot'), true);
  assert.equal(operators.source.dataSource, 'local-game-tables');

  const ember = operators.operators.find(
    (operator) => operator.id === 'char_180_amgoat',
  );
  const ignition = ember.skills.find((skill) => skill.name === '点燃');
  const volcano = ember.skills.find((skill) => skill.name === '火山');
  assert.equal(ember.stats.e2.attack, 645);
  assert.equal(ember.stats.trust.attack, 90);
  assert.equal(ignition.levels.M3.cost, 5);
  assert.equal(ignition.levels.M3.maxChargeTime, 3);
  assert.equal(volcano.levels.M3.intervalDelta, -1.1);
});

test('Muelsyse conversion equipment and covenant-target equipment exist', () => {
  const equipment = JSON.parse(
    fs.readFileSync(
      new URL('../data/equipment.json', import.meta.url),
      'utf8',
    ),
  );
  const converter = equipment.equipment.find(
    (item) => item.id === 'chess_item_6_03_e_a',
  );
  const target = equipment.equipment.find(
    (item) => item.name === '炎国短刀',
  );

  assert.equal(converter.name, '变形同构体');
  assert.equal(converter.description.includes('携带者获得额外盟约'), true);
  assert.equal(target.bondId, 'yanShip');
});
