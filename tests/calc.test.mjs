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
  sharedBossHp,
  inferDamageType,
  estimateEpBurstDps,
  estimateElementCycleDps,
  estimateSiracusaAbnormalDps,
  classifySkillOutput,
  mergeTalentEffects,
  summarizeDamageMetrics,
  summarizeEnemyWaveHp,
  resolveAutochessEnemyStats,
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

test('damage metrics convert simulated hit totals into per-hit DPH', () => {
  assert.equal(typeof summarizeDamageMetrics, 'function');
  const metrics = summarizeDamageMetrics({
    normalDph: 1200,
    skillDph: 3000,
    cycleDps: 1000,
    horizon: 120,
    killTime: null,
  });

  assert.equal(metrics.normalDph, 1200);
  assert.equal(metrics.skillDph, 3000);
});

test('damage metrics report total and elemental damage over the measured window', () => {
  assert.equal(typeof summarizeDamageMetrics, 'function');
  const metrics = summarizeDamageMetrics({
    normalHit: 0,
    activeHit: 0,
    cycleDps: 500,
    epBurstDps: 20,
    epBurstBonusDps: 5,
    horizon: 120,
    killTime: 7.5,
  });

  assert.equal(metrics.windowSeconds, 7.5);
  assert.equal(metrics.totalDamage, 3750);
  assert.equal(metrics.elementDamage, 187.5);
});

test('autochess regular enemies apply the mode factor to base stats', () => {
  assert.equal(typeof resolveAutochessEnemyStats, 'function');
  const result = resolveAutochessEnemyStats(
    {
      category: 'regular',
      baseHp: 1000,
      baseAttack: 100,
      baseDefense: 50,
      baseResistance: 20,
    },
    {
      factor: 1.5,
      attackFactor: 5,
      defenseFactor: 3,
      resistanceFactor: 3,
    },
  );

  assert.equal(result.hp, 1500);
  assert.equal(result.attack, 750);
  assert.equal(result.defense, 225);
  assert.equal(result.resistance, 60);
});

test('autochess boss blood table overrides base hp without mode multiplication', () => {
  assert.equal(typeof resolveAutochessEnemyStats, 'function');
  const result = resolveAutochessEnemyStats(
    {
      category: 'boss',
      bossId: 'boss_1',
      baseHp: 600000,
      baseAttack: 650,
      baseDefense: 1000,
      baseResistance: 25,
    },
    {
      factor: 1.5,
      attackFactor: 5,
      defenseFactor: 3,
      resistanceFactor: 3,
    },
    {
      bossHpByMode: {
        boss_1: 3940000,
      },
    },
  );

  assert.equal(result.hp, 3940000);
  assert.equal(result.attack, 4875);
  assert.equal(result.defense, 4500);
  assert.equal(result.resistance, 75);
});

test('enemy wave hp multiplies spawn counts, base hp and mode factor', () => {
  assert.equal(typeof summarizeEnemyWaveHp, 'function');
  const total = summarizeEnemyWaveHp(
    [
      { enemyId: 'enemy_a', count: 2 },
      { enemyId: 'enemy_b', count: 3 },
    ],
    {
      enemy_a: 1000,
      enemy_b: 500,
    },
    1.2,
  );

  assert.equal(total, 4200);
});

test('optional enemy effects apply only to resolved enemy stats', () => {
  const baseEnemy = {
    category: 'regular',
    baseHp: 1000,
    baseAttack: 100,
    baseDefense: 50,
    baseResistance: 20,
    attackSpeed: 100,
    moveSpeed: 1,
  };
  const mode = {
    factor: 1.5,
    attackFactor: 5,
    defenseFactor: 3,
    resistanceFactor: 3,
  };
  const result = resolveAutochessEnemyStats(baseEnemy, mode, {
    enemyEffect: {
      hpMultiplier: 1.2,
      attackMultiplier: 1.1,
      attackSpeedAdd: 10,
      moveSpeedAdd: 0.3,
    },
  });

  assert.equal(result.hp, 1800);
  assert.ok(Math.abs(result.attack - 825) < 1e-9);
  assert.equal(result.attackSpeed, 110);
  assert.equal(result.moveSpeed, 1.3);
});

test('local autochess round snapshot covers all multiplayer rounds and boss tables', () => {
  const snapshotPath = new URL(
    '../data/autochess-rounds.json',
    import.meta.url,
  );
  assert.equal(fs.existsSync(snapshotPath), true);
  const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
  const modes = snapshot.modes;

  assert.deepEqual(Object.keys(modes), [
    'mode_multi_funny',
    'mode_multi_normal',
    'mode_multi_hard',
    'mode_multi_abyss',
  ]);
  assert.equal(
    modes.mode_multi_funny.rounds.find((round) => round.round === 13)
      .normalHpMin,
    614900,
  );
  assert.equal(
    modes.mode_multi_abyss.rounds.find((round) => round.round === 13)
      .normalHpMin,
    922350,
  );
  assert.equal(
    modes.mode_multi_abyss.rounds.find((round) => round.round === 14)
      .variants.length,
    10,
  );
  assert.equal(
    modes.mode_multi_abyss.rounds.find((round) => round.round === 15)
      .variants.length,
    6,
  );
  assert.equal(
    snapshot.bossHpByMode.boss_15.mode_multi_abyss,
    7885000,
  );
  assert.equal(snapshot.enemyEffects.length, 40);
  assert.equal(snapshot.randomEnemyAttributes.count, 456);
  assert.deepEqual(snapshot.randomEnemyAttributes.levelValues, [0]);
});

test('frame simulation separates per-hit damage from multi-hit attack totals', () => {
  const result = simulateFrameDps({
    attack: 1000,
    baseInterval: 1,
    damageType: 'true',
    enemy: { def: 0, res: 0, hp: Infinity },
    normalHits: 2,
    skillHits: 3,
    activeMultiplier: 2,
    duration: 10,
    cooldown: 0,
    horizon: 10,
    sp: {
      mode: 'natural',
      cost: 1,
      initial: 1,
      perSecond: 1,
      maxCharges: 1,
      blockFrames: 0,
      frameRate: 30,
    },
  });

  assert.equal(result.normalDph, 1000);
  assert.equal(result.skillDph, 2000);
  assert.equal(result.normalHit, 2000);
  assert.equal(result.activeHit, 6000);
});

test('element burst uses the local enemy values, break threshold, and cooldown', () => {
  assert.equal(
    estimateEpBurstDps({
      dps: 1000,
      ratio: 0.1,
      type: '灼燃',
      threshold: 1000,
    }),
    350,
  );
  assert.equal(
    estimateEpBurstDps({
      dps: 1000,
      ratio: 0.1,
      type: '灼燃',
      threshold: 2000,
    }),
    700 / 3,
  );
  assert.ok(
    estimateEpBurstDps({
      dps: 100000,
      ratio: 0.1,
      type: '灼燃',
      threshold: 1000,
    }) > 690,
  );
  assert.equal(
    estimateEpBurstDps({
      dps: 1250,
      ratio: 0.1,
      type: '侵蚀',
      threshold: 1000,
    }),
    312.5,
  );
  assert.equal(
    estimateEpBurstDps({
      flatPerSecond: 100,
      type: '神经',
      threshold: 1000,
    }),
    300,
  );
  assert.equal(
    estimateEpBurstDps({
      dps: 1000,
      ratio: 0.1,
      type: '凋亡',
      threshold: 1000,
    }),
    480,
  );
});

test('element resistances affect accumulation and burst damage separately', () => {
  assert.equal(
    estimateEpBurstDps({
      dps: 1000,
      ratio: 0.1,
      type: '灼燃',
      threshold: 2000,
      resistance: 10,
      damageResistance: 10,
    }),
    195.51724137931035,
  );
});

test('Siracusa true damage requires two applicable distinct abnormalities', () => {
  const oneType = estimateSiracusaAbnormalDps({
    prob: 0.3,
    duration: 1.18,
    damage: 1800,
    attemptsPerSecond: 5,
    eligibleTypes: 1,
    targets: 6,
  });
  const fourTypes = estimateSiracusaAbnormalDps({
    prob: 0.3,
    duration: 1.18,
    damage: 1800,
    attemptsPerSecond: 5,
    eligibleTypes: 4,
    targets: 6,
  });

  assert.equal(oneType.uptime, 0);
  assert.equal(oneType.dps, 0);
  assert.equal(fourTypes.uptime > 0, true);
  assert.equal(fourTypes.dps > 0, true);
  assert.equal(fourTypes.attemptsPerSecond, 5);
});

test('element gauges accumulate separately by damage type', () => {
  const sources = [
    { type: '灼燃', ratio: 0.25, basis: 'damage' },
    { type: '侵蚀', ratio: 0.25, basis: 'damage' },
    { type: '神经', ratio: 0.25, basis: 'damage' },
    { type: '凋亡', ratio: 0.25, basis: 'damage' },
  ];
  const result = estimateElementCycleDps({
    sources,
    dps: 1000,
    threshold: 1000,
  });

  assert.deepEqual(Object.keys(result.details).sort(), [
    '侵蚀',
    '凋亡',
    '灼燃',
    '神经',
  ]);
  assert.equal(Object.values(result.details).every(
    (detail) => detail.impairmentPerSecond === 250,
  ), true);
  assert.equal(result.recoveryMode, 'global');

  const globalRecovery = estimateElementCycleDps({
    sources,
    dps: 1000,
    threshold: 1000,
    horizon: 120,
    recoveryMode: 'global',
  });
  const separateRecovery = estimateElementCycleDps({
    sources,
    dps: 1000,
    threshold: 1000,
    horizon: 120,
    recoveryMode: 'independent',
  });
  assert.equal(globalRecovery.cycleDps, 650);
  assert.equal(separateRecovery.cycleDps > globalRecovery.cycleDps, true);
});

test('shared boss hp scales with the room player count', () => {
  assert.equal(sharedBossHp(3940000, 1), 3940000);
  assert.equal(sharedBossHp(3940000, 2), 7880000);
  assert.equal(sharedBossHp(3940000, 3), 11820000);
  assert.equal(sharedBossHp(3940000, 4), 15760000);
  assert.equal(sharedBossHp(3940000, 8), 15760000);
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

  assert.equal(hints.attackBonus, 1.3);
  assert.equal(hints.attackMultiplier, 1);
  assert.equal(hints.intervalDelta, -1.1);
});

test('Volcano attack bonus is not counted again as a direct damage multiplier', () => {
  const hints = estimateSkillHints(
    '攻击力+130%，攻击范围增大，攻击间隔大幅度缩短，攻击变为随机对攻击范围内至多6个敌人发射熔岩',
    {
      atk: 1.3,
      base_attack_time: -1.1,
      'attack@max_target': 6,
    },
  );

  assert.equal(hints.attackBonus, 1.3);
  assert.equal(hints.attackMultiplier, 1);
  assert.equal(hints.targetCap, 6);
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

test('skill hints parse direct scaling, ramps and multi-hit wording', () => {
  const amiya = estimateSkillHints(
    '每次攻击变为攻击力60%的8连发，随机攻击范围内的目标',
  );
  const mlynar = estimateSkillHints(
    '攻击造成相当于190%攻击力的二连击。',
  );
  const chen = estimateSkillHints(
    '下次攻击对周围最多6名地面敌人造成两次相当于攻击力220%的物理伤害',
  );
  const air = estimateSkillHints(
    '立即发射箭矢对目标进行攻击力140%的5次攻击；可充能3次',
  );
  const pursuit = estimateSkillHints(
    '下次攻击造成相当于攻击力175%的物理伤害，并连续攻击两次',
  );
  const followUp = estimateSkillHints(
    '下次攻击额外造成一次相当于攻击力180%的法术伤害',
  );
  const extraAttack = estimateSkillHints(
    '下次攻击额外攻击一个目标并造成相当于攻击力300%的法术伤害',
  );
  const lemuen = estimateSkillHints(
    '期间攻击力从180%逐渐提升至425%',
  );
  const rampedArts = estimateSkillHints(
    '每秒造成一次相当于攻击力75%的法术伤害',
  );
  const healing = estimateSkillHints(
    '下次治疗可以恢复相当于攻击力190%的生命；可充能2次',
  );
  const groupedBuff = estimateSkillHints(
    '攻击力、防御力和生命上限各+130%',
  );

  assert.deepEqual(
    [amiya.attackMultiplier, amiya.skillHits],
    [0.6, 8],
  );
  assert.deepEqual(
    [mlynar.attackMultiplier, mlynar.skillHits],
    [1.9, 2],
  );
  assert.deepEqual(
    [chen.attackMultiplier, chen.skillHits],
    [2.2, 2],
  );
  assert.deepEqual(
    [air.attackMultiplier, air.skillHits],
    [1.4, 5],
  );
  assert.equal(pursuit.skillHits, 2);
  assert.deepEqual(
    [followUp.attackMultiplier, followUp.skillHits],
    [2.8, 1],
  );
  assert.deepEqual(
    [extraAttack.attackMultiplier, extraAttack.skillHits],
    [4, 1],
  );
  assert.equal(lemuen.attackMultiplier, 1);
  assert.equal(lemuen.attackBonus, 2.025);
  assert.equal(rampedArts.attackMultiplier, 0.75);
  assert.equal(healing.attackMultiplier, 1);
  assert.equal(groupedBuff.attackMultiplier, 1);
  assert.equal(groupedBuff.attackBonus, 1.3);
});

test('skill hints prefer structured local Blackboard values', () => {
  const amiya = estimateSkillHints(
    '每次攻击变为攻击力60%的8连发',
    { 'attack@atk_scale': 0.6, 'attack@times': 8 },
    1,
  );
  const ignition = estimateSkillHints(
    '下次攻击造成法术伤害；可充能3次',
    { atk_scale: 1.85, fk: 3.7, ct: 3 },
    3,
  );
  const chargeUp = estimateSkillHints(
    '攻击力+20%；蓄力额外效果：停顿变为束缚',
    { atk: 0.2 },
    2,
  );
  const judgment = estimateSkillHints(
    '造成攻击力300%的伤害，然后快速轰击12次，每次造成攻击力250%的伤害',
    {
      atk_scale: 3,
      multi_atk_scale: 2.5,
      multi_times: 12,
    },
    1,
  );
  const logos = estimateSkillHints(
    '每秒造成伤害',
    { 'attack@atk_scale_base': 0.75 },
    1,
  );
  const lemuen = estimateSkillHints(
    '期间攻击力从180%逐渐提升至425%',
    {
      'attack@main_atk_scale': 1.8,
      'attack@fin_atk_scale': 4.25,
    },
    1,
  );

  assert.deepEqual(
    [amiya.attackMultiplier, amiya.skillHits],
    [0.6, 8],
  );
  assert.deepEqual(
    [ignition.attackMultiplier, ignition.charges, ignition.chargeBased],
    [3.7, 3, true],
  );
  assert.deepEqual(
    [chargeUp.charges, chargeUp.chargeBased],
    [0, false],
  );
  assert.deepEqual(
    [judgment.attackMultiplier, judgment.skillHits],
    [33 / 13, 13],
  );
  assert.equal(logos.attackMultiplier, 0.75);
  assert.equal(lemuen.attackMultiplier, 3.025);
});

test('skill hints read local elemental impairment ratios and flat values', () => {
  const scaled = estimateSkillHints(
    '每秒造成法术伤害和相当于法术伤害30%的灼燃损伤',
    { element_damage_scale: 0.3 },
  );
  const flat = estimateSkillHints(
    '每秒受到200点侵蚀损伤',
    { 'attack@water_element': 200 },
  );

  assert.deepEqual(scaled.ep, {
    ratio: 0.3,
    flatPerSecond: 0,
    type: '灼燃',
    basis: 'damage',
  });
  assert.deepEqual(flat.ep, {
    ratio: 0,
    flatPerSecond: 200,
    type: '侵蚀',
    basis: 'damage',
  });
});

test('skill hints retain local single-target, capped, and area target rules', () => {
  const single = estimateSkillHints('造成相当于攻击力200%的物理伤害', {});
  const capped = estimateSkillHints(
    '同时攻击3名敌人，造成相当于攻击力180%的法术伤害',
    { 'attack@max_target': 3 },
  );
  const area = estimateSkillHints(
    '攻击范围内所有敌人并造成群体法术伤害',
    {},
  );
  const directional = estimateSkillHints(
    '对前方范围内的地面敌人造成攻击力300%的法术伤害',
    {},
  );
  const linear = estimateSkillHints(
    '攻击对直线范围造成攻击力200%的物理伤害',
    {},
  );

  assert.equal(single.targetCap, 1);
  assert.equal(capped.targetCap, 3);
  assert.equal(area.targetCap, Infinity);
  assert.equal(directional.targetCap, Infinity);
  assert.equal(linear.targetCap, Infinity);
});

test('Talulah S3 cluster fire explosion uses area target coverage', () => {
  const hints = estimateSkillHints(
    '攻击力+140%；停止攻击以持续引导场地进入以下状态：每2.67秒在5行范围内，朝部署方向召唤“簇火”，“簇火”碰到敌人时爆炸造成攻击力250%的范围法术伤害',
    {
      atk: 1.4,
      normal_interval: 2.67,
      overload_interval: 2,
    },
  );

  assert.equal(hints.attackBonus, 1.4);
  assert.equal(hints.attackMultiplier, 2.5);
  assert.equal(hints.fixedActiveInterval, 2.67);
  assert.equal(hints.targetCap, Infinity);
});

test('element hints retain attack scaling, priority types, and burst bonuses', () => {
  const attackScaled = estimateSkillHints(
    '攻击附带相当于攻击力25%的神经损伤',
    { 'attack@ep_damage_ratio': 0.25 },
  );
  const priority = estimateSkillHints(
    '攻击同时附带18%攻击力的神经损伤（优先）、灼燃损伤、凋亡损伤',
    { ep_damage_ratio: 0.18 },
  );
  const perHit = estimateSkillHints(
    '若目标处于凋亡损伤爆发期间则额外造成相当于攻击力50%的元素伤害',
    { 'attack@extra_ep_damage_scale': 0.5 },
  );
  const perSecond = estimateSkillHints(
    '攻击处于凋亡损伤爆发期间的敌人时每秒受到攻击力30%的元素伤害',
    { element_atk_scale: 0.3 },
  );

  assert.equal(attackScaled.ep.basis, 'attack');
  assert.deepEqual(priority.epSources.map((source) => source.type), [
    '神经',
  ]);
  assert.equal(perHit.epBurst.perHitScale, 0.5);
  assert.equal(perHit.epBurst.perSecondScale, 0);
  assert.equal(perSecond.epBurst.perHitScale, 0);
  assert.equal(perSecond.epBurst.perSecondScale, 0.3);
});

test('local elemental operators use the correct attack-or-damage basis', () => {
  const snapshot = JSON.parse(
    fs.readFileSync(
      new URL('../data/operators-autochess.json', import.meta.url),
      'utf8',
    ),
  );
  const operator = (name) =>
    snapshot.operators.find((item) => item.name === name);
  const skillHint = (name, skillName) => {
    const skill = operator(name).skills.find(
      (item) => item.name === skillName,
    );
    const level = skill.levels.M3 ?? Object.values(skill.levels)[0];
    return estimateSkillHints(
      level.description,
      level.blackboard,
      level.maxChargeTime,
    );
  };

  assert.equal(skillHint('余', '今日做东').ep.basis, 'attack');
  assert.equal(skillHint('酒神', '群体性谵妄').ep.basis, 'attack');
  assert.equal(skillHint('妮芙', '笞心击').ep.basis, 'damage');
  assert.equal(skillHint('克莱门莎', '冲蚀').ep.basis, 'damage');
  assert.equal(skillHint('真言', '共鸣溃缩').ep.basis, 'damage');
  assert.equal(skillHint('烛煌', '炙手之援').ep.basis, 'damage');
});

test('damage type uses the main hit type and falls back to the trait', () => {
  // The skill's main hit wins over the operator's normal-attack trait.
  assert.equal(inferDamageType('攻击造成法术伤害', '造成物理伤害'), 'physical');
  assert.equal(inferDamageType('攻击造成物理伤害', ''), 'physical');
  // Trait is the fallback when the skill text carries no damage type.
  assert.equal(inferDamageType('攻击造成法术伤害', ''), 'arts');
  // Explicit type conversion still wins over everything.
  assert.equal(
    inferDamageType('攻击造成法术伤害', '伤害类型变为真实'),
    'true',
  );
  // Add-on elemental damage no longer overrides a physical/arts main hit.
  assert.equal(
    inferDamageType('攻击造成法术伤害', '造成攻击力200%的物理伤害并额外造成元素伤害'),
    'physical',
  );
});

test('non-damage and stop-attack skills are classified conservatively', () => {
  assert.deepEqual(classifySkillOutput('攻击造成相当于攻击力200%的伤害'), {
    hasDamage: true,
    suppressActive: false,
  });
  assert.deepEqual(classifySkillOutput('停止攻击敌人；防御力+120%'), {
    hasDamage: false,
    suppressActive: true,
  });
  assert.deepEqual(classifySkillOutput('恢复相当于攻击力180%的生命'), {
    hasDamage: false,
    suppressActive: true,
  });
  assert.deepEqual(classifySkillOutput('攻击力+60%，攻击速度+60'), {
    hasDamage: false,
    suppressActive: false,
  });
  assert.deepEqual(
    classifySkillOutput('屏障能吸收相当于攻击力90%的法术伤害'),
    {
      hasDamage: false,
      suppressActive: true,
    },
  );
  assert.deepEqual(
    classifySkillOutput('我方单位受到伤害的50%转移给该干员承担'),
    {
      hasDamage: false,
      suppressActive: false,
    },
  );
  assert.deepEqual(
    classifySkillOutput(
      '友方干员受到的物理与法术伤害的50%变为持续5秒的生命流失',
    ),
    {
      hasDamage: false,
      suppressActive: false,
    },
  );
});

test('talent multipliers use multiplication while additive stats accumulate', () => {
  const effects = {
    attackBonus: 10,
    damageMultiplier: 1,
    flatHitDamage: 0,
  };

  mergeTalentEffects(effects, {
    attackBonus: 20,
    damageMultiplier: 1.17,
    flatHitDamage: 50,
    unknown: 999,
  });
  mergeTalentEffects(effects, {
    attackBonus: 5,
    damageMultiplier: 1.1,
  });

  assert.deepEqual(effects, {
    attackBonus: 35,
    damageMultiplier: 1.287,
    flatHitDamage: 50,
  });
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

test('global attack speed affects normal attacks in frame simulation', () => {
  const simulate = (normalAspd) =>
    simulateFrameDps({
      attack: 100,
      baseInterval: 1,
      damageType: 'true',
      enemy: { def: 0, res: 0, hp: Infinity },
      normalAspd,
      activeMultiplier: 2,
      duration: 5,
      cooldown: 5,
      tick: 0.1,
      horizon: 20,
    });

  const baseline = simulate(0);
  const accelerated = simulate(100);

  assert.equal(accelerated.normalHits > baseline.normalHits, true);
  assert.equal(accelerated.normalInterval, 0.5);
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

test('six Yan grants random elemental impairment and enemy break recovery', () => {
  const snapshot = JSON.parse(
    fs.readFileSync(
      new URL('../data/covenants.json', import.meta.url),
      'utf8',
    ),
  );
  const yan = snapshot.covenants.find(
    (bond) => bond.bondId === 'yanShip',
  );
  const inactive = evaluateCovenant(yan, 100, 5);
  const active = evaluateCovenant(yan, 100, 6);

  assert.equal(inactive.effects.randomElement, null);
  assert.equal(active.effects.extraDamageMultiplier, 0);
  assert.equal(active.effects.randomElement.ratio, 0.06);
  assert.deepEqual(active.effects.randomElement.types, [
    '灼燃',
    '凋亡',
    '侵蚀',
    '神经',
  ]);
  assert.equal(
    Math.abs(active.effects.enemyEpRecoverSpeed - 0.7) < 1e-9,
    true,
  );

  const randomDamage = estimateElementCycleDps({
    sources: active.effects.randomElement.types.map((type) => ({
      type,
      ratio: active.effects.randomElement.ratio / 4,
      basis: 'attack',
    })),
    attack: 1668,
    attacksPerSecond: 1.3,
    threshold: 2000,
    recoverySpeed: active.effects.enemyEpRecoverSpeed,
    horizon: 120,
  });
  assert.equal(randomDamage.cycleDps, 250);
});

test('Aegir devour and Kjerag cold multipliers match local Blackboard data', () => {
  const snapshot = JSON.parse(
    fs.readFileSync(
      new URL('../data/covenants.json', import.meta.url),
      'utf8',
    ),
  );
  const egir = snapshot.covenants.find(
    (bond) => bond.bondId === 'egirShip',
  );
  const kjerag = snapshot.covenants.find(
    (bond) => bond.bondId === 'kjeragShip',
  );
  const egirResult = evaluateCovenant(egir, 100, 6);
  const kjeragNormal = evaluateCovenant(kjerag, 100, 6);
  const kjeragCold = evaluateCovenant(kjerag, 100, 6, {
    enemyCold: true,
  });

  assert.equal(egirResult.effects.hpBonus, 135);
  assert.equal(egirResult.effects.egirDevour, true);
  assert.equal(egirResult.effects.egirDamageValue, 5000);
  assert.equal(egirResult.effects.egirRespawns, 3);
  assert.equal(kjeragNormal.effects.damageMultiplier, 1.25);
  assert.equal(kjeragCold.effects.damageMultiplier, 2.35);
  assert.equal(kjeragCold.effects.kjeragColdMultiplier, 2.35);
});

test('Kjerag snow giant resolves to the local hidden enemy profile', () => {
  const snapshot = JSON.parse(
    fs.readFileSync(
      new URL('../data/enemies.json', import.meta.url),
      'utf8',
    ),
  );
  const giant = snapshot.enemies.find(
    (enemy) => enemy.enemyId === 'enemy_9024_acsgnt',
  );

  assert.equal(giant.name, '“不眠雪山”');
  assert.equal(giant.baseHp, 21000);
  assert.equal(giant.baseAttack, 920);
  assert.equal(giant.baseDefense, 600);
  assert.equal(giant.baseResistance, 30);
  assert.equal(giant.attackInterval, 3);
  assert.equal(giant.talentBlackboard['BondBuff.stackStep'], 3);
  assert.equal(giant.talentBlackboard['FrozenBreak.atk_scale'], 3.5);
  assert.equal(giant.talentBlackboard['SwitchMode.interval'], 5);
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

test('fixed-frame simulation adds flat per-hit talent damage', () => {
  const result = simulateFrameDps({
    attack: 100,
    baseInterval: 1,
    damageType: 'arts',
    enemy: { def: 0, res: 50, hp: Infinity },
    flatHitDamage: 50,
    tick: 0.1,
    horizon: 2,
  });

  assert.equal(result.normalHit, 100);
  assert.equal(result.totalDamage, 200);
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
  assert.equal(result.activeDps > 0, true);
});

test('charged instant skills use SP recovery blocks and frame-quantized intervals', () => {
  const simulate = (options = {}) =>
    simulateFrameDps({
      attack: 100,
      baseInterval: 1.6,
      damageType: 'true',
      enemy: { def: 0, res: 0, hp: Infinity },
      activeMultiplier: 4,
      duration: 0,
      tick: 1 / 60,
      horizon: 60,
      ...options,
      sp: {
        mode: 'natural',
        cost: 5,
        initial: 0,
        perSecond: 10,
        maxCharges: 3,
        blockFrames: 36,
        frameRate: 30,
        ...(options.sp ?? {}),
      },
    });

  const blocked = simulate();
  const unblocked = simulate({ sp: { blockFrames: 0 } });
  assert.equal(unblocked.skillCasts > blocked.skillCasts, true);
  assert.equal(blocked.skillHits, blocked.skillCasts);

  // 30 fps frame quantization: 1.6s = 48 frames; +33 ASPD -> 37 frames;
  // +34 ASPD -> 36 frames, matching the in-game 36-frame SP block threshold.
  assert.equal(blocked.normalInterval, 48 / 30);
  assert.equal(simulate({ normalAspd: 33 }).normalInterval, 37 / 30);
  assert.equal(simulate({ normalAspd: 34 }).normalInterval, 36 / 30);
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

test('autochess trait parser covers unconditional and flat attack bonuses', () => {
  const raw = evaluateAutoChessTrait(
    '攻击力和生命上限+60%',
    [],
  );
  const flat = evaluateAutoChessTrait(
    '【卡西米尔】每叠加5层，本干员部署后100秒内基础攻击力+10',
    [100],
  );

  assert.equal(raw.effects.attackBonus, 60);
  assert.equal(flat.effects.flatAttack, 10);
});

test('all relevant autochess traits expose a parsed numeric effect', () => {
  const traits = JSON.parse(
    fs.readFileSync(
      new URL('../data/autochess-traits.json', import.meta.url),
      'utf8',
    ),
  ).traits;
  const relevantTerms = [
    '技力自然回复速度',
    '攻击速度',
    '攻击力',
  ];
  const unparsed = traits.filter((trait) => {
    if (!relevantTerms.some((term) => trait.description.includes(term))) {
      return false;
    }
    const effects = evaluateAutoChessTrait(
      trait.description,
      [100, 100],
    ).effects;
    return (
      !effects.spPerSecond &&
      !effects.attackBonus &&
      !effects.aspd &&
      !effects.flatAttack
    );
  });

  assert.deepEqual(unparsed, []);
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
