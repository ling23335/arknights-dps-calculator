import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import '../src/calc.js';
const {
  damageAfterMitigation,
  calculateCycleDps,
  resolveOperatorStats,
  estimateSkillHints,
  calculateDpsModel,
  simulateFrameDps,
  inferDamageType,
  matchOperatorName,
  evaluateCovenant,
  evaluateAutoChessTrait,
} = globalThis.ArkCalc;
import { parseOperatorWikitext } from '../src/prts-parser.js';

test('physical damage subtracts defense', () => {
  assert.equal(
    damageAfterMitigation(1000, 'physical', { def: 320, res: 50 }),
    680,
  );
});

test('cycle dps weights active and ready phases by time', () => {
  assert.equal(
    calculateCycleDps({
      normalDps: 1000,
      activeDps: 2000,
      duration: 10,
      cooldown: 30,
    }),
    1250,
  );
});

test('operator wikitext becomes calculator data', () => {
  const operator = parseOperatorWikitext(`
{{CharinfoV2
<!--下方为自动更新部分，您的修改可能会被覆盖-->
|干员名=测试干员
|职业=术师
|分支=中坚术师
|稀有度=5
|位置=远程位
|特性=攻击造成法术伤害
}}
{{属性
|攻击速度=1.6s
|精英2_满级_攻击=645
|信赖加成_攻击=90
|潜能=,27,,,
|潜能类型=,atk,,,
}}
{{技能2
|技能名=点燃
|技能类型1=自动回复
|技能类型2=自动触发
|技能专精3描述=下三次攻击造成相当于攻击力370%的法术伤害
|技能专精3消耗=5
|技能专精3持续=
|技能专精3初始=0
}}
`);

  assert.equal(operator.name, '测试干员');
  assert.equal(operator.profession, '术师');
  assert.equal(operator.stats.e2.attack, 645);
  assert.equal(operator.stats.trust.attack, 90);
  assert.equal(operator.potential.mods[0].level, 3);
  assert.equal(operator.skills[0].name, '点燃');
  assert.equal(operator.skills[0].levels.M3.description.includes('370%'), true);
});

test('operator stats include trust, potential and module attack', () => {
  const stats = resolveOperatorStats(
    {
      stats: {
        e2: { attack: 645 },
        trust: { attack: 90 },
      },
      potential: {
        mods: [
          { level: 2, type: 'cost', amount: -1 },
          { level: 4, type: 'atk', amount: 27 },
        ],
      },
      modules: [{ name: '测试模组', attack: 65 }],
    },
    { trust: true, potential: 4, module: '测试模组' },
  );

  assert.equal(stats.attack, 827);
});

test('operator stats fall back when elite two is unavailable', () => {
  const stats = resolveOperatorStats(
    {
      stats: {
        e2: { attack: null },
        e1: { attack: 300 },
        trust: { attack: 0 },
      },
      potential: { mods: [] },
      modules: [],
    },
    { trust: false, potential: 1 },
  );

  assert.equal(stats.attack, 300);
});

test('skill hints extract attack multiplier and interval change', () => {
  const hints = estimateSkillHints(
    '攻击力+130%，攻击间隔大幅度缩短(-1.1)，攻击范围增大',
  );

  assert.equal(hints.attackMultiplier, 2.3);
  assert.equal(hints.intervalDelta, -1.1);
});

test('skill hints extract attack speed bonus', () => {
  const hints = estimateSkillHints('攻击速度+60，攻击力+60%');

  assert.equal(hints.aspd, 60);
});

test('skill hints extract stored charge count', () => {
  const hints = estimateSkillHints(
    '下次攻击造成相当于攻击力370%的法术伤害\n可充能3次',
  );

  assert.equal(hints.charges, 3);
  assert.equal(hints.chargeBased, true);
});

test('damage type prefers explicit art damage in the skill text', () => {
  assert.equal(inferDamageType('攻击造成法术伤害', '造成物理伤害'), 'arts');
  assert.equal(inferDamageType('攻击造成物理伤害', ''), 'physical');
});

test('dps model combines mitigation, attack interval and skill cycle', () => {
  const result = calculateDpsModel({
    attack: 1000,
    baseInterval: 1,
    damageType: 'physical',
    enemy: { def: 300, res: 0 },
    activeMultiplier: 2,
    intervalDelta: -0.5,
    duration: 10,
    cooldown: 10,
  });

  assert.equal(result.normalDps, 700);
  assert.equal(result.activeDps, 3400);
  assert.equal(result.cycleDps, 2050);
});

test('skill attack speed does not speed up normal attacks', () => {
  const result = calculateDpsModel({
    attack: 1000,
    baseInterval: 1,
    damageType: 'true',
    aspd: 100,
    duration: 10,
    cooldown: 10,
  });

  assert.equal(result.normalDps, 1000);
  assert.equal(result.activeDps, 2000);
});

test('operator search resolves a partial name', () => {
  assert.equal(
    matchOperatorName(['阿米娅', '艾雅法拉', '逻各斯'], ' 逻各 '),
    '逻各斯',
  );
});

test('current precision covenant uses its exact blackboard parameters', () => {
  const result = evaluateCovenant(
    {
      bondId: 'preciShip',
      activeCount: 2,
      buffs: [
        {
          Blackboard: {
            base_atk: 0.1,
            atk_per_stack: 0.012,
            power_def_penetrate: 0.3,
            power_magic_resist_penetrate: 0.3,
            power_bond_char_cnt: 3,
          },
        },
      ],
    },
    100,
    3,
  );

  assert.equal(result.effects.attackBonus, 130);
  assert.equal(result.effects.defensePenetration, 0.3);
  assert.equal(result.effects.resistancePenetration, 0.3);
});

test('current arcane covenant scales extra damage and resistance shred', () => {
  const result = evaluateCovenant(
    {
      bondId: 'arcaneShip',
      activeCount: 2,
      buffs: [
        { Blackboard: { atk_base: 0.2, atk_per_stack: 0.004 } },
        {
          Blackboard: {
            magic_res_max_base: -30,
            magic_res_max_per_stack: -0.05,
            magic_res_max_min: -100,
          },
        },
      ],
    },
    50,
    3,
  );

  assert.equal(result.effects.extraDamageMultiplier, 0.4);
  assert.equal(result.effects.resistanceShred, 32.5);
});

test('dps model supports percentage defense and resistance penetration', () => {
  const physical = calculateDpsModel({
    attack: 1000,
    baseInterval: 1,
    damageType: 'physical',
    enemy: { def: 1000, res: 0 },
    defensePenetration: 0.3,
  });
  const arts = calculateDpsModel({
    attack: 1000,
    baseInterval: 1,
    damageType: 'arts',
    enemy: { def: 0, res: 50 },
    resistancePenetration: 0.3,
  });

  assert.equal(physical.normalHit, 300);
  assert.equal(arts.normalHit, 650);
});

test('fixed-frame simulation schedules normal and skill hits by time', () => {
  const result = simulateFrameDps({
    attack: 100,
    baseInterval: 1,
    damageType: 'true',
    enemy: { def: 0, res: 0, hp: Infinity },
    normalMultiplier: 1,
    activeMultiplier: 2,
    duration: 5,
    cooldown: 5,
    tick: 0.5,
    horizon: 20,
  });

  assert.equal(result.ticks, 40);
  assert.equal(result.normalHits, 10);
  assert.equal(result.skillHits, 10);
  assert.equal(result.skillCasts, 2);
  assert.equal(result.totalDamage, 3000);
  assert.equal(result.dps, 150);
  assert.equal(result.skillUptime, 0.5);
});

test('fixed-frame simulation stops at the ultimate enemy hp', () => {
  const result = simulateFrameDps({
    attack: 500,
    baseInterval: 1,
    damageType: 'true',
    enemy: { def: 0, res: 0, hp: 1000 },
    tick: 0.1,
    horizon: 120,
  });

  assert.equal(result.totalDamage, 1000);
  assert.equal(result.killTime, 2);
  assert.equal(result.dps, 500);
});

test('instant skills can recharge after their triggering attack', () => {
  const result = simulateFrameDps({
    attack: 100,
    baseInterval: 1,
    damageType: 'true',
    enemy: { def: 0, res: 0, hp: Infinity },
    activeMultiplier: 2,
    duration: 0,
    cooldown: 2,
    tick: 0.1,
    horizon: 10,
  });

  assert.equal(result.skillCasts >= 3, true);
  assert.equal(result.activeDamage > result.normalDamage, true);
});

test('charged instant skills use SP recovery blocks and can lower DPS at high attack speed', () => {
  const simulate = (normalAspd) =>
    simulateFrameDps({
      attack: 100,
      baseInterval: 1.6,
      damageType: 'true',
      enemy: { def: 0, res: 0, hp: Infinity },
      normalAspd,
      activeMultiplier: 4,
      duration: 0,
      tick: 1 / 60,
      horizon: 60,
      sp: {
        mode: 'natural',
        cost: 5,
        initial: 0,
        perSecond: 10,
        maxCharges: 3,
        blockFrames: 36,
        frameRate: 30,
      },
    });

  const slow = simulate(17);
  const fast = simulate(18);

  assert.equal(slow.skillCasts > fast.skillCasts, true);
  assert.equal(slow.cycleDps > fast.cycleDps, true);
});

test('natural SP recovery accelerates duration skills through the same state machine', () => {
  const simulate = (perSecond) =>
    simulateFrameDps({
      attack: 100,
      baseInterval: 1,
      damageType: 'true',
      enemy: { def: 0, res: 0, hp: Infinity },
      activeMultiplier: 2,
      duration: 5,
      tick: 1 / 60,
      horizon: 60,
      sp: {
        mode: 'natural',
        cost: 10,
        initial: 0,
        perSecond,
        maxCharges: 1,
        blockFrames: 0,
        frameRate: 30,
      },
    });

  const slow = simulate(1);
  const fast = simulate(2);
  assert.equal(fast.skillCasts > slow.skillCasts, true);
  assert.equal(fast.cycleDps > slow.cycleDps, true);
  assert.equal(fast.skillCasts <= 7, true);
  assert.equal(fast.activeTime <= 35, true);
});

test('autochess character trait scales SP recovery and attack by layer blocks', () => {
  const result = evaluateAutoChessTrait(
    '【莱塔尼亚】【奥术】每叠加2层，本干员技力自然回复速度+0.02/秒，攻击力+1%',
    [100, 50],
  );

  assert.equal(result.effects.spPerSecond, 1.5);
  assert.equal(result.effects.attackBonus, 75);
  assert.equal(result.stacks, 75);
});

test('all 26 local covenants provide an effect summary', () => {
  const snapshot = JSON.parse(
    fs.readFileSync(
      new URL('../data/covenants.json', import.meta.url),
      'utf8',
    ),
  );
  const results = snapshot.covenants.map((bond) =>
    evaluateCovenant(bond, 100, bond.activeCount),
  );

  assert.equal(results.length, 26);
  assert.equal(results.every((result) => result.metrics.length > 0), true);
});

test('stronghold enemy snapshot has usable defense and resistance profiles', () => {
  const snapshot = JSON.parse(
    fs.readFileSync(
      new URL('../data/enemies.json', import.meta.url),
      'utf8',
    ),
  );
  const bosses = snapshot.enemies.filter(
    (enemy) => enemy.category === 'boss',
  );

  assert.equal(snapshot.enemyCount, snapshot.enemies.length);
  assert.equal(snapshot.enemies.length >= 100, true);
  assert.equal(bosses.length >= 10, true);
  assert.equal(
    snapshot.enemies.every(
      (enemy) =>
        Number.isFinite(enemy.defense) &&
        Number.isFinite(enemy.resistance),
    ),
    true,
  );
});
