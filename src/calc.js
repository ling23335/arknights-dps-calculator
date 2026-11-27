const ATTACK_FRAME_RATE = 30;

// Arknights resolves attacks on 30 fps frames, so the effective interval is
// the computed interval rounded UP to the next frame (1.6s -> 48 frames,
// 1.6s at +33 ASPD -> 37 frames, matching the 36-frame SP block threshold).
function quantizeAttackInterval(seconds) {
  const value = Math.max(0.05, Number(seconds) || 0);
  return Math.ceil(value * ATTACK_FRAME_RATE - 1e-9) / ATTACK_FRAME_RATE;
}

function damageAfterMitigation(rawDamage, damageType, enemy = {}) {
  if (damageType === 'physical') {
    return Math.max(rawDamage - Math.max(0, enemy.def ?? 0), rawDamage * 0.05);
  }
  if (damageType === 'arts') {
    const resistance = Math.min(95, Math.max(0, enemy.res ?? 0));
    return rawDamage * (1 - resistance / 100);
  }
  return rawDamage;
}

function calculateCycleDps({
  normalDps,
  activeDps,
  duration,
  cooldown,
}) {
  const activeTime = Math.max(0, duration);
  const readyTime = Math.max(0, cooldown);
  const cycleLength = activeTime + readyTime;
  if (cycleLength === 0) return Math.max(0, activeDps);
  return (normalDps * readyTime + activeDps * activeTime) / cycleLength;
}

function summarizeDamageMetrics(result = {}) {
  const windowSeconds = Number.isFinite(result.killTime)
    ? Math.max(0, result.killTime)
    : Math.max(0, Number(result.horizon) || 0);
  const normalHits = Math.max(1, Number(result.normalHits) || 1);
  const skillHits = Math.max(1, Number(result.skillHits) || 1);
  const cycleDps = Math.max(
    0,
    Number(result.cycleDps ?? result.dps) || 0,
  );
  const elementDps =
    Math.max(0, Number(result.epBurstDps) || 0) +
    Math.max(0, Number(result.epBurstBonusDps) || 0);

  return {
    windowSeconds,
    normalDph: Math.max(0, Number(result.normalDph) || 0),
    skillDph: Math.max(0, Number(result.skillDph) || 0),
    totalDamage: cycleDps * windowSeconds,
    normalDamage: Math.max(0, Number(result.normalDamage) || 0),
    skillDamage: Math.max(0, Number(result.activeDamage) || 0),
    elementDamage: elementDps * windowSeconds,
  };
}

function resolveAutochessEnemyStats(enemy, mode, options = {}) {
  const factor = Math.max(0, Number(mode?.factor) || 1);
  const attackFactor = Math.max(0, Number(mode?.attackFactor) || 1);
  const defenseFactor = Math.max(0, Number(mode?.defenseFactor) || 1);
  const resistanceFactor = Math.max(0, Number(mode?.resistanceFactor) || 1);
  const enemyEffect = options.enemyEffect ?? {};
  const hpEffectFactor = Math.max(
    0,
    Number(enemyEffect.hpMultiplier) || 1,
  );
  const attackEffectFactor = Math.max(
    0,
    Number(enemyEffect.attackMultiplier) || 1,
  );
  const bossHp = Number(options.bossHpByMode?.[enemy?.bossId]);
  const baseHp = Math.max(0, Number(enemy?.baseHp) || 0);
  const refractionHpBonus = Math.max(
    0,
    Number(enemy?.refraction?.hpBonus) || 0,
  );
  const refractionResistance = Math.max(
    0,
    Number(enemy?.refraction?.magicResistanceBonus) || 0,
  );
  const hp =
    enemy?.category === 'boss' && Number.isFinite(bossHp)
      ? bossHp
      : baseHp * factor;

  return {
    hp: hp * (1 + refractionHpBonus) * hpEffectFactor,
    attack:
      Math.max(0, Number(enemy?.baseAttack) || 0) *
      attackFactor *
      factor *
      attackEffectFactor,
    defense:
      Math.max(0, Number(enemy?.baseDefense) || 0) * defenseFactor * factor,
    resistance: Math.min(
      100,
      Math.max(0, Number(enemy?.baseResistance) || 0) * resistanceFactor +
        refractionResistance,
    ),
    attackSpeed: Math.max(
      0,
      (Number(enemy?.attackSpeed) || 0) +
        (Number(enemyEffect.attackSpeedAdd) || 0),
    ),
    moveSpeed: Math.max(
      0,
      (Number(enemy?.moveSpeed) || 0) *
        (1 + (Number(enemyEffect.moveSpeedAdd) || 0)),
    ),
  };
}

function summarizeEnemyWaveHp(actions = [], enemyHpById = {}, factor = 1) {
  const multiplier = Math.max(0, Number(factor) || 1);
  return actions.reduce((total, action) => {
    const hp = Math.max(0, Number(enemyHpById[action.enemyId]) || 0);
    const count = Math.max(0, Number(action.count) || 0);
    return total + hp * count * multiplier;
  }, 0);
}

function resolveOperatorStats(
  operator,
  { trust = true, potential = 1, module = '' } = {},
) {
  const source =
    (operator.stats.e2?.attack != null && operator.stats.e2) ||
    (operator.stats.e1?.attack != null && operator.stats.e1) ||
    operator.stats.e0;
  const potentialAttack = (operator.potential?.mods ?? [])
    .filter((mod) => mod.type === 'atk' && mod.level <= potential)
    .reduce((sum, mod) => sum + mod.amount, 0);
  const selectedModule = (operator.modules ?? []).find(
    (item) => item.name === module,
  );

  return {
    attack:
      (source.attack ?? 0) +
      (trust ? operator.stats.trust?.attack ?? 0 : 0) +
      potentialAttack +
      (selectedModule?.attack ?? 0),
    attackInterval: operator.stats.attackInterval ?? 1,
    defense: (source.defense ?? 0) + (trust ? operator.stats.trust?.defense ?? 0 : 0),
    resistance: source.resistance ?? 0,
    hp: (source.hp ?? 0) + (trust ? operator.stats.trust?.hp ?? 0 : 0),
  };
}

function estimateSkillHints(
  description = '',
  blackboard = {},
  maxChargeTime = 1,
) {
  const numberMap = {
    一: 1,
    两: 2,
    二: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
    十: 10,
  };
  const parseCount = (value) =>
    Number(value) || numberMap[value] || 1;
  const scalePatterns = [
    /造成[^。\n]{0,24}?相当于攻击力\s*(\d+(?:\.\d+)?)%/,
    /造成[^。\n]{0,24}?相当于\s*(\d+(?:\.\d+)?)%攻击力/,
    /造成[^。\n]{0,24}?攻击力\s*(\d+(?:\.\d+)?)%/,
    /造成[^。\n]{0,24}?(\d+(?:\.\d+)?)%攻击力/,
    /攻击力\s*(\d+(?:\.\d+)?)%\s*的[^。\n]{0,12}(?:伤害|连击|连发|攻击)/,
    /造成[^。\n]{0,20}?(\d+(?:\.\d+)?)%的?(?:范围)?(?:物理|法术|真实|元素)?伤害/,
    /(\d+(?:\.\d+)?)%的攻击力/,
  ];
  const scaleMatch = scalePatterns
    .map((pattern) => description.match(pattern))
    .find(Boolean);
  const directScale = scaleMatch ? Number(scaleMatch[1]) / 100 : 1;
  const rampMatch = description.match(
    /攻击力从\s*(\d+(?:\.\d+)?)%\s*[^。\n]{0,4}?(?:提升至|提高至|增加至|增至)\s*(\d+(?:\.\d+)?)%/,
  );
  const rampScale = rampMatch
    ? (Number(rampMatch[1]) + Number(rampMatch[2])) / 200
    : 0;
  const toBuffMatch =
    description.match(
      /攻击力[^。\n]{0,8}?(?:提升至|提高至|增加至|增至)\s*([+]?)\s*(\d+(?:\.\d+)?)%/,
    );
  const addBuffMatch =
    description.match(
      /攻击力(?:提升|增加|提高|\+)\s*(\d+(?:\.\d+)?)%/,
    ) ??
    description.match(
      /攻击力[、和与](?:防御力|生命上限|攻击速度)[^。\n]{0,12}?各?[+＋]\s*(\d+(?:\.\d+)?)%/,
    ) ??
    description.match(
      /攻击力[^。\n]{0,8}?\+\s*(\d+(?:\.\d+)?)%/,
    );
  const toBuffScale = toBuffMatch
    ? (toBuffMatch[1] ? 1 : 0) + Number(toBuffMatch[2]) / 100
    : 0;
  const addBuffScale = addBuffMatch
    ? 1 + Number(addBuffMatch[1]) / 100
    : 0;
  let attackMultiplier = scaleMatch ? directScale : 1;
  const extraDamageMatch = description.match(
    /额外(?:攻击(?:一个目标|1名敌人)[^。\n]{0,12}?并)?造成(?:([0-9一二两三四五六七八九十]+)次)?[^。\n]{0,12}?(?:相当于)?攻击力\s*(\d+(?:\.\d+)?)%/,
  );
  const followUpDamageMatch = description.match(
    /追加(?:([0-9一二两三四五六七八九十]+)次)?[^。\n]{0,12}?(?:相当于)?攻击力\s*(\d+(?:\.\d+)?)%/,
  );
  if (extraDamageMatch) {
    const hits = parseCount(extraDamageMatch[1] ?? '1');
    attackMultiplier = Math.max(
      attackMultiplier,
      1 + hits * Number(extraDamageMatch[2]) / 100,
    );
  } else if (followUpDamageMatch) {
    const hits = parseCount(followUpDamageMatch[1] ?? '1');
    attackMultiplier +=
      hits * Number(followUpDamageMatch[2]) / 100;
  }
  const blackboardScaleKeys = [
    'fk',
    'attack@atk_scale',
    'damage_scale',
    'attack@damage_scale',
    'attack@aoe_atk_scale',
    'attack@physical_atk_scale',
    'attack@magic_atk_scale',
    'aoe_damage_scale',
    'atk_scale',
    'atk_scale_1',
    'atk_scale_2',
    'atk_scale_s1',
    'atk_scale_s2',
    'atk_scale_s3',
    'attack@atk_scale_base',
    'attack@atk_scale_s2',
    'attack@atk_scale_s3',
    'attack@main_atk_scale',
  ];
  const blackboardScale = blackboardScaleKeys
    .map((key) => Number(blackboard[key]))
    .find((value) => Number.isFinite(value) && value > 0);
  const attackBonusFromBlackboard = Number(blackboard.atk);
  const rampIsDamageScale =
    Boolean(rampMatch && blackboardScale) &&
    !Number.isFinite(attackBonusFromBlackboard);
  if (rampIsDamageScale) {
    attackMultiplier = Math.max(attackMultiplier, rampScale);
  }
  const hasTextScale = Boolean(
    scaleMatch ||
      extraDamageMatch ||
      followUpDamageMatch ||
      rampIsDamageScale,
  );
  let resolvedAttackMultiplier =
    !blackboardScale
      ? attackMultiplier
      : rampMatch
        ? rampScale
        : hasTextScale
          ? Math.max(attackMultiplier, blackboardScale)
          : blackboardScale;
  const textAttackBonus =
    rampMatch && !rampIsDamageScale
      ? Math.max(0, rampScale - 1)
      : Math.max(
          toBuffScale ? Math.max(0, toBuffScale - 1) : 0,
          addBuffScale ? Math.max(0, addBuffScale - 1) : 0,
        );
  const resolvedAttackBonus = Math.round(
    (Number.isFinite(attackBonusFromBlackboard)
      ? attackBonusFromBlackboard
      : textAttackBonus) * 1e9,
  ) / 1e9;

  const interval = description.match(
    /攻击间隔[^。；，,]*[（(]\s*([-+]?\d+(?:\.\d+)?)\s*[）)]/,
  );
  const aspdMatch = description.match(/攻击速度\s*[+＋]\s*(\d+(?:\.\d+)?)/);
  const chargeMatch = description.match(/可(?:以)?充能\s*(\d+)\s*次/);
  const repeatedTimes = Number(blackboard.multi_times);
  const repeatedScale = Number(blackboard.multi_atk_scale);
  if (
    Number.isInteger(repeatedTimes) &&
    repeatedTimes >= 2 &&
    Number.isFinite(repeatedScale) &&
    repeatedScale > 0 &&
    blackboardScale > 0
  ) {
    resolvedAttackMultiplier =
      (blackboardScale + repeatedTimes * repeatedScale) /
      (repeatedTimes + 1);
  }
  const hitCountKeys = [
    'attack@times',
    'times',
    'attack@cnt',
  ];
  let blackboardHits = hitCountKeys
    .map((key) => Number(blackboard[key]))
    .find(
      (value) =>
        Number.isInteger(value) &&
        value >= 2 &&
        value <= 20,
    );
  if (
    Number.isInteger(repeatedTimes) &&
    repeatedTimes >= 2 &&
    Number.isFinite(repeatedScale) &&
    repeatedScale > 0
  ) {
    blackboardHits = repeatedTimes + 1;
  }
  const hitPatterns = [
    /([0-9一二两三四五六七八九十]+)连(?:击|发)/,
    /(?:连续攻击|连续射击|进行)([0-9一二两三四五六七八九十]+)次/,
    /(?:连续攻击|进行)([0-9一二两三四五六七八九十]+)次攻击/,
    /造成([0-9一二两三四五六七八九十]+)次相当于/,
    /(?:发动|造成)([0-9一二两三四五六七八九十]+)次(?:斩击|攻击)/,
    /([0-9一二两三四五六七八九十]+)次攻击/,
  ];
  const hitMatch = hitPatterns
    .map((pattern) => description.match(pattern))
    .find(Boolean);
  const extraSlashMatch = description.match(
    /额外斩击(?:目标)?\s*([0-9一二两三四五六七八九十]+)\s*次/,
  );
  const extraSlashHits = extraSlashMatch ? parseCount(extraSlashMatch[1]) : 0;
  const skillHits = Math.max(
    hitMatch ? parseCount(hitMatch[1]) : 1,
    blackboardHits ?? 1,
    extraSlashHits ? extraSlashHits + 1 : 1,
  );

  // Skills that replace the normal attack with a fixed cadence
  // (e.g. Talulah S3 spawns 簇火 every normal_interval seconds).
  const fixedActiveInterval =
    Number(blackboard.normal_interval) > 0
      ? Number(blackboard.normal_interval)
      : Number(blackboard.overload_interval) > 0
        ? Number(blackboard.overload_interval)
        : 0;
  // 4 skills (Angelina S2 / Blackkey S2 / Indigo S2 / Ember S2) store the
  // absolute new interval in base_attack_time even though it is positive.
  const bbInterval = Number(blackboard.base_attack_time);
  const saysShorter =
    /攻击间隔[^。]{0,8}缩短|缩短[^。]{0,8}攻击间隔/.test(description);
  const absoluteActiveInterval =
    Number.isFinite(bbInterval) && bbInterval > 0 && saysShorter
      ? bbInterval
      : 0;
  // attack_speed on enemies is a debuff, not a self buff.
  const bbAspd = Number(blackboard.attack_speed);
  const aspdIsEnemyDebuff = /敌人[^。\n]{0,16}攻击速度/.test(description);
  const resolvedAspd =
    Number.isFinite(bbAspd) && bbAspd !== 0 && !aspdIsEnemyDebuff
      ? bbAspd
      : aspdMatch
        ? Number(aspdMatch[1])
        : 0;
  const epRatioCandidates = [
    blackboard['attack@ep_damage_ratio'],
    blackboard['ep_damage_ratio'],
    blackboard['attack@ep_damage_ratio_token'],
    blackboard['ep_damage_ratio_token'],
    blackboard.element_damage_scale,
    blackboard.element_multiplier,
  ]
    .map(Number)
    .filter(Number.isFinite);
  const epRatioRaw = Math.max(0, ...epRatioCandidates);
  // Some skills deal a flat amount of element impairment instead of scaling
  // with the damage of the hit (e.g. Clementia S2).
  const epFlatRaw = Math.max(
    0,
    ...[
      blackboard['attack@water_element'],
      blackboard['attack@fire_element'],
      blackboard['attack@dark_element'],
      blackboard['attack@sanity_element'],
    ]
      .map(Number)
      .filter(Number.isFinite),
  );
  const epTypes = ['灼燃', '凋亡', '侵蚀', '神经']
    .map((type) => ({
      type,
      index: description.indexOf(`${type}损伤`),
    }))
    .filter((item) => item.index >= 0)
    .sort((a, b) => a.index - b.index)
    .map((item) => item.type);
  // A priority list means only the first eligible type is applied.
  const prioritizedTypes = /（优先）/.test(description)
    ? epTypes.slice(0, 1)
    : epTypes;
  const firstEpDescriptionIndex =
    epTypes.length > 0 ? description.indexOf(`${epTypes[0]}损伤`) : -1;
  const epLead =
    firstEpDescriptionIndex >= 0
      ? description.slice(
          Math.max(0, firstEpDescriptionIndex - 45),
          firstEpDescriptionIndex,
        )
      : '';
  const lastAttackMention = epLead.lastIndexOf('攻击力');
  const lastDamageMention = epLead.lastIndexOf('伤害');
  const epBasis =
    lastAttackMention >= 0 && lastAttackMention > lastDamageMention
      ? 'attack'
      : 'damage';
  const targetCountMatch = description.match(
    /(?:同时攻击|攻击最多|最多攻击|对最多|至多)\s*([0-9一二两三四五六七八九十]+)\s*(?:名|个|位)?(?:敌人|目标)/,
  );
  const targetCounts = [
    blackboard['attack@max_target'],
    blackboard.max_target,
    blackboard['attack@max_target_ceil'],
  ]
    .map(Number)
    .filter((value) => Number.isFinite(value) && value > 0);
  const explicitTargetCap = targetCountMatch
    ? parseCount(targetCountMatch[1])
    : targetCounts.length
      ? Math.max(...targetCounts)
      : 0;
  const hitsAllTargets =
    /群体(?:物理|法术|真实)?伤害|范围(?:物理|法术|真实|元素)?伤害|范围[^。\n]{0,16}(?:造成|受到)[^。\n]{0,20}(?:物理|法术|真实|元素)?伤害|范围[^。\n]{0,16}敌人[^。\n]{0,20}造成[^。\n]{0,16}伤害|范围内所有敌人|攻击范围内所有|周围所有敌人|全体敌人|溅射伤害|爆炸造成[^。\n]{0,20}范围/.test(
      description,
    );
  const targetCap = explicitTargetCap || (hitsAllTargets ? Infinity : 1);
  const epSources = prioritizedTypes.map((type) => ({
    type,
    ratio: epRatioRaw,
    flatPerSecond: epFlatRaw,
    basis: epBasis,
  }));
  const epType = epSources[0]?.type ?? '';
  const perHitBurstScaleRaw = Math.max(
    0,
    ...[
      blackboard['attack@extra_ep_damage_scale'],
      blackboard['attack@element_atk_scale'],
      blackboard.element_atk_scale,
    ]
      .map(Number)
      .filter(Number.isFinite),
  );
  const burstPerHitScale =
    /爆发期间/.test(description) &&
    /元素伤害/.test(description) &&
    !/每秒/.test(description)
      ? perHitBurstScaleRaw
      : 0;
  const burstPerSecondScale =
    /爆发期间/.test(description) &&
    /每秒/.test(description) &&
    /元素伤害/.test(description)
      ? perHitBurstScaleRaw
      : 0;
  const burstPerBreakScale =
    /爆发(?:开始|时)/.test(description) &&
    /元素伤害/.test(description) &&
    Number.isFinite(Number(blackboard.ep_damage_scale))
      ? Math.max(0, Number(blackboard.ep_damage_scale)) *
        Math.max(
          1,
          parseCount(
            description.match(
              /造成\s*([0-9一二两三四五六七八九十]+)\s*次[^。\n]{0,30}元素伤害/,
            )?.[1] ?? 1,
          ),
        )
      : 0;

  return {
    attackMultiplier: resolvedAttackMultiplier,
    intervalDelta: interval ? Number(interval[1]) : 0,
    aspd: resolvedAspd,
    charges: chargeMatch ? Number(chargeMatch[1]) : 0,
    chargeBased: Boolean(chargeMatch),
    maxChargeTime,
    skillHits,
    fixedActiveInterval,
    attackBonus: resolvedAttackBonus,
    absoluteActiveInterval,
    targetCap,
    ep: {
      ratio: epRatioRaw,
      flatPerSecond: epFlatRaw,
      type: epType,
      basis: epBasis,
    },
    epSources,
    epBurst: {
      perHitScale: burstPerHitScale,
      perSecondScale: burstPerSecondScale,
      perBreakScale: burstPerBreakScale,
    },
  };
}

function inferDamageType(trait = '', skillDescription = '') {
  const desc = String(skillDescription ?? '');
  const traitText = String(trait ?? '');

  // 1. explicit type conversion wins.
  if (/伤害类型(?:变为|转为)\s*真实/.test(desc)) return 'true';
  if (/伤害类型(?:变为|转为)\s*法术/.test(desc)) return 'arts';

  // 2. drop secondary clauses (extra hits / add-on elemental or DoT damage)
  //    so they do not override the main hit type.
  const main = desc
    .split(/[。；;\n]/)
    .map((part) =>
      part
        .replace(/额外[^，,。；;\n]*/g, ' ')
        .replace(/附带[^，,。；;\n]*/g, ' ')
        .replace(/残留[^，,。；;\n]*/g, ' ')
        .replace(/持续[^，,。；;\n]{0,16}伤害/g, ' '),
    )
    .join('；');

  // 3. main damage phrase: "造成 ... X伤害"
  const mainHit = main.match(
    /造成[^，,。；;\n]{0,50}?(物理|法术|真实|元素)伤害/,
  );
  if (mainHit) {
    if (mainHit[1] === '真实' || mainHit[1] === '元素') return 'true';
    return mainHit[1] === '法术' ? 'arts' : 'physical';
  }

  // 4. fall back to the (secondary-clause-stripped) text.
  if (/真实伤害/.test(main)) return 'true';
  if (/法术伤害/.test(main)) return 'arts';
  if (/元素伤害/.test(main)) return 'true';
  if (/物理伤害/.test(main)) return 'physical';

  // 5. trait-level default (elemental mentions alone are not enough).
  if (/物理伤害/.test(traitText)) return 'physical';
  if (/法术伤害/.test(traitText)) return 'arts';
  return 'physical';
}

// Enemy-side values from the local game data:
// gamedata_const61fefd.json TermDescriptionDict.ba.dt.*2
// buff_tablea22aef.json ep_break_{fire,water,dark,sanity}_enemy
// ep_breakbuff_table1cdc7b (burst duration/cooldowns and enemy break duration)
const EP_BURST_DATA = Object.freeze({
  灼燃: { damage: 7000, cooldown: 10 },
  侵蚀: { damage: 5000, cooldown: 8 },
  神经: { damage: 6000, cooldown: 10 },
  凋亡: { damage: 800 * 15, cooldown: 15 },
});

function estimateElementCycleDps({
  sources = [],
  dps = 0,
  attack = 0,
  attacksPerSecond = 0,
  resistance = 0,
  damageResistance = 0,
  threshold = 1000,
  recoverySpeed = 0,
  horizon = 120,
  recoveryMode = 'global',
} = {}) {
  // Local IL2CPP metadata exposes m_epArray for per-type accumulation, while
  // EPController has one m_isInBreakRecovery timer and one recoveryType.
  // Therefore gauges are separate, but bursts share one global recovery state.
  const breakThreshold = Number(threshold);
  if (!(breakThreshold > 0)) {
    return {
      cycleDps: 0,
      details: {},
      damageResistanceScale: 1,
      recoveryMode,
    };
  }
  const epResistanceScale =
    1 - Math.min(95, Math.max(0, Number(resistance) || 0)) / 100;
  const damageResistanceScale =
    1 -
    Math.min(95, Math.max(0, Number(damageResistance) || 0)) / 100;
  const recoveryScale =
    1 + Math.max(0, Number(recoverySpeed) || 0);
  const grouped = new Map();
  for (const source of sources) {
    const type = source?.type;
    if (!EP_BURST_DATA[type]) continue;
    const ratio = Math.max(0, Number(source.ratio) || 0);
    const flat = Math.max(0, Number(source.flatPerSecond) || 0);
    const basisDps =
      source.basis === 'attack'
        ? Math.max(0, Number(attack) || 0) *
          Math.max(0, Number(attacksPerSecond) || 0)
        : Math.max(0, Number(dps) || 0);
    const impairment = (basisDps * ratio + flat) * epResistanceScale;
    if (!(impairment > 0)) continue;
    grouped.set(type, (grouped.get(type) ?? 0) + impairment);
  }

  const details = {};
  if (recoveryMode === 'independent' || grouped.size <= 1) {
    let cycleDps = 0;
    for (const [type, impairmentPerSecond] of grouped) {
      const burst = EP_BURST_DATA[type];
      const cooldown = burst.cooldown / recoveryScale;
      const cycle =
        breakThreshold / impairmentPerSecond + cooldown;
      const burstsPerSecond = 1 / cycle;
      const damageDps =
        burstsPerSecond *
        burst.damage *
        Math.max(0, damageResistanceScale);
      details[type] = {
        impairmentPerSecond,
        cooldown,
        cycle,
        burstsPerSecond,
        uptime: Math.min(1, cooldown / cycle),
        damageDps,
      };
      cycleDps += damageDps;
    }
    return { cycleDps, details, damageResistanceScale, recoveryMode };
  }

  const gauges = Object.fromEntries(
    [...grouped.keys()].map((type) => [type, 0]),
  );
  const bursts = Object.fromEntries(
    [...grouped.keys()].map((type) => [type, 0]),
  );
  const recoveryTime = Object.fromEntries(
    [...grouped.keys()].map((type) => [type, 0]),
  );
  const duration = Math.max(0.1, Number(horizon) || 120);
  const step = 0.05;
  let cooldownRemaining = 0;
  let recoveryType = '';
  for (let time = 0; time < duration; time += step) {
    if (cooldownRemaining > 0) {
      const elapsed = Math.min(step, cooldownRemaining);
      cooldownRemaining -= elapsed;
      if (recoveryType) recoveryTime[recoveryType] += elapsed;
      continue;
    }
    let triggeredType = '';
    let bestProgress = -1;
    for (const [type, impairmentPerSecond] of grouped) {
      gauges[type] = Math.min(
        breakThreshold,
        gauges[type] + impairmentPerSecond * step,
      );
      const progress = gauges[type] / breakThreshold;
      if (progress > bestProgress) {
        bestProgress = progress;
        triggeredType = type;
      }
    }
    if (bestProgress >= 1) {
      gauges[triggeredType] = 0;
      bursts[triggeredType] += 1;
      recoveryType = triggeredType;
      cooldownRemaining =
        EP_BURST_DATA[triggeredType].cooldown / recoveryScale;
    } else {
      triggeredType = '';
    }
  }

  let cycleDps = 0;
  for (const [type, impairmentPerSecond] of grouped) {
    const burst = EP_BURST_DATA[type];
    const cooldown = burst.cooldown / recoveryScale;
    const burstsPerSecond = bursts[type] / duration;
    const damageDps =
      burstsPerSecond *
      burst.damage *
      Math.max(0, damageResistanceScale);
    details[type] = {
      impairmentPerSecond,
      cooldown,
      cycle: burstsPerSecond > 0 ? 1 / burstsPerSecond : Infinity,
      burstsPerSecond,
      uptime: recoveryTime[type] / duration,
      damageDps,
    };
    cycleDps += damageDps;
  }
  return { cycleDps, details, damageResistanceScale, recoveryMode };
}

function estimateEpBurstDps({
  dps = 0,
  ratio = 0,
  flatPerSecond = 0,
  type = '',
  resistance = 0,
  damageResistance = 0,
  threshold = 1000,
  recoverySpeed = 0,
} = {}) {
  return estimateElementCycleDps({
    sources: [{ type, ratio, flatPerSecond, basis: 'damage' }],
    dps,
    resistance,
    damageResistance,
    threshold,
    recoverySpeed,
  }).cycleDps;
}

function estimateSiracusaAbnormalDps({
  prob = 0,
  duration = 0,
  damage = 0,
  attemptsPerSecond = 0,
  eligibleTypes = 0,
  totalTypes = 4,
  targets = 1,
  cooldown = 0.2,
} = {}) {
  const statusCount = Math.max(0, Math.floor(Number(eligibleTypes) || 0));
  const typeCount = Math.max(1, Math.floor(Number(totalTypes) || 4));
  const attemptRate = Math.min(
    1 / Math.max(0.05, Number(cooldown) || 0.2),
    Math.max(0, Number(attemptsPerSecond) || 0),
  );
  const activeProb =
    1 -
    Math.exp(
      -attemptRate *
        Math.max(0, Number(prob) || 0) /
        typeCount *
        Math.max(0, Number(duration) || 0),
    );
  const uptime =
    statusCount >= 2
      ? Math.max(
          0,
          1 -
            (1 - activeProb) ** statusCount -
            statusCount *
              activeProb *
              (1 - activeProb) ** (statusCount - 1),
        )
      : 0;
  return {
    attemptsPerSecond: attemptRate,
    activeProb,
    uptime,
    dps:
      uptime *
      Math.max(0, Number(damage) || 0) *
      Math.max(1, Number(targets) || 1),
  };
}

function classifySkillOutput(description = '') {
  const text = String(description ?? '');
  const redirectsIncomingDamage =
    /受到[^。\n]{0,24}伤害[^。\n]{0,24}(?:转移|承担|变为[^。\n]{0,12}生命流失)/.test(
      text,
    );
  const hasDamage =
    (!redirectsIncomingDamage &&
      /(?:造成|打出|命中|使[^。\n]{0,24}受到|(?:每秒)?受到)[^。\n]{0,30}(?:伤害|损伤)/.test(
        text,
      )) ||
    /(?:伤害类型|伤害)(?:变为|转为)/.test(text);
  const stopsAttack = text.includes('停止攻击');
  const healingOnly =
    !hasDamage &&
    /(?:治疗|恢复[^。\n]{0,12}生命|屏障)/.test(text);
  return {
    hasDamage,
    suppressActive: !hasDamage && (stopsAttack || healingOnly),
  };
}

function mergeTalentEffects(target, source = {}) {
  for (const [key, rawValue] of Object.entries(source)) {
    if (!(key in target)) continue;
    const value = Number(rawValue);
    if (!Number.isFinite(value)) continue;
    if (key === 'damageMultiplier') target[key] *= value;
    else target[key] += value;
  }
  return target;
}

function calculateDpsModel({
  attack,
  baseInterval,
  damageType = 'physical',
  enemy = {},
  attackBonus = 0,
  normalAspd = 0,
  aspd = 0,
  normalMultiplier = 1,
  activeMultiplier = 1,
  intervalDelta = 0,
  activeIntervalOverride = 0,
  normalHits = 1,
  skillHits = 1,
  duration = 0,
  cooldown = 0,
  defenseIgnore = 0,
  resistanceIgnore = 0,
  defensePenetration = 0,
  resistancePenetration = 0,
}) {
  const effectiveAttack = Math.max(0, attack) * (1 + attackBonus / 100);
  const normalSpeedScale = 1 + Math.max(-95, normalAspd) / 100;
  const activeSpeedScale = 1 + Math.max(-95, aspd) / 100;
  const normalInterval = quantizeAttackInterval(
    Math.max(0.05, baseInterval) / normalSpeedScale,
  );
  const activeInterval =
    activeIntervalOverride > 0
      ? Math.max(0.05, activeIntervalOverride)
      : quantizeAttackInterval(
          Math.max(0.05, baseInterval + intervalDelta) / activeSpeedScale,
        );
  const defenseScale = 1 - Math.min(1, Math.max(0, defensePenetration));
  const resistanceScale =
    1 - Math.min(1, Math.max(0, resistancePenetration));
  const mitigatedEnemy = {
    def: Math.max(0, (enemy.def ?? 0) * defenseScale - defenseIgnore),
    res: Math.max(0, (enemy.res ?? 0) * resistanceScale - resistanceIgnore),
  };
  const normalDph = damageAfterMitigation(
    effectiveAttack * normalMultiplier,
    damageType,
    mitigatedEnemy,
  );
  const skillDph = damageAfterMitigation(
    effectiveAttack * activeMultiplier,
    damageType,
    mitigatedEnemy,
  );
  const normalHit = normalDph * Math.max(1, normalHits);
  const activeHit = skillDph * Math.max(1, skillHits);
  const normalDps = normalHit / normalInterval;
  const activeDps = activeHit / activeInterval;
  const cycleDps = calculateCycleDps({
    normalDps,
    activeDps,
    duration,
    cooldown,
  });

  return {
    effectiveAttack,
    normalInterval,
    activeInterval,
    normalDph,
    skillDph,
    normalHit,
    activeHit,
    normalDps,
    activeDps,
    cycleDps,
    activeTime: Math.max(0, duration),
    readyTime: Math.max(0, cooldown),
  };
}

function simulateFrameDps({
  attack,
  baseInterval,
  damageType = 'physical',
  enemy = {},
  attackBonus = 0,
  normalAspd = 0,
  aspd = 0,
  normalMultiplier = 1,
  activeMultiplier = 1,
  intervalDelta = 0,
  activeIntervalOverride = 0,
  normalHits = 1,
  skillHits = 1,
  duration = 0,
  cooldown = 0,
  defenseIgnore = 0,
  resistanceIgnore = 0,
  defensePenetration = 0,
  resistancePenetration = 0,
  flatHitDamage = 0,
  sp = null,
  tick = 1 / 60,
  horizon = 120,
}) {
  const step = Math.max(0.001, Number(tick) || 1 / 60);
  const maxTicks = Math.max(1, Math.ceil((Number(horizon) || 120) / step));
  const epsilon = step / 1000;
  const effectiveAttack = Math.max(0, attack) * (1 + attackBonus / 100);
  const normalSpeedScale = 1 + Math.max(-95, normalAspd) / 100;
  const activeSpeedScale =
    1 + Math.max(-95, normalAspd + aspd) / 100;
  const normalInterval = quantizeAttackInterval(
    Math.max(0.05, baseInterval) / normalSpeedScale,
  );
  const activeInterval =
    activeIntervalOverride > 0
      ? Math.max(0.05, activeIntervalOverride)
      : quantizeAttackInterval(
          Math.max(0.05, baseInterval + intervalDelta) / activeSpeedScale,
        );
  const defenseScale = 1 - Math.min(1, Math.max(0, defensePenetration));
  const resistanceScale =
    1 - Math.min(1, Math.max(0, resistancePenetration));
  const mitigatedEnemy = {
    def: Math.max(0, (enemy.def ?? 0) * defenseScale - defenseIgnore),
    res: Math.max(0, (enemy.res ?? 0) * resistanceScale - resistanceIgnore),
  };
  const normalDph =
    damageAfterMitigation(
      effectiveAttack * normalMultiplier,
      damageType,
      mitigatedEnemy,
    ) + Math.max(0, flatHitDamage);
  const skillDph =
    damageAfterMitigation(
      effectiveAttack * activeMultiplier,
      damageType,
      mitigatedEnemy,
    ) + Math.max(0, flatHitDamage);
  const normalHit = normalDph * Math.max(1, normalHits);
  const activeHit = skillDph * Math.max(1, skillHits);

  if (sp?.maxCharges > 0) {
    const cost = Math.max(epsilon, Number(sp.cost) || 1);
    const maxCharges = Math.max(1, Number(sp.maxCharges) || 1);
    const storedCap = cost * maxCharges;
    const frameRate = Math.max(1, Number(sp.frameRate) || 30);
    const blockSeconds = Math.max(
      0,
      Number(sp.blockFrames) || 0,
    ) / frameRate;
    let storedSp = Math.min(
      storedCap,
      Math.max(0, Number(sp.initial) || 0),
    );
    let blockUntil = 0;
    let lastTime = 0;
    let time = 0;
    let nextAttack = normalInterval;
    let activeRemaining = 0;
    let normalTime = 0;
    let activeTime = 0;
    let normalDamage = 0;
    let activeDamage = 0;
    let normalHitCount = 0;
    let activeHitCount = 0;
    let skillCasts = 0;
    let remainingHp = Number.isFinite(enemy.hp)
      ? Math.max(0, enemy.hp)
      : Infinity;
    let killTime = null;

    for (
      let frame = 0;
      frame < maxTicks && time < horizon;
      frame += 1
    ) {
      const dt = Math.min(step, horizon - time);
      time += dt;
      if (activeRemaining > 0) {
        activeTime += dt;
        activeRemaining = Math.max(0, activeRemaining - dt);
      } else {
        normalTime += dt;
      }
      if (
        activeRemaining <= epsilon &&
        sp.mode === 'natural' &&
        time > blockUntil
      ) {
        storedSp = Math.min(
          storedCap,
          storedSp +
            Math.max(0, Number(sp.perSecond) || 0) *
              Math.max(0, time - Math.max(lastTime, blockUntil)),
        );
      }

      while (nextAttack <= time + epsilon && remainingHp > 0) {
        let charged = activeRemaining > epsilon;
        if (!charged && storedSp >= cost - epsilon) {
          storedSp = Math.max(0, storedSp - cost);
          skillCasts += 1;
          activeRemaining = Math.max(0, duration);
          charged = true;
          if (duration <= epsilon) {
            blockUntil = time + Math.min(blockSeconds, normalInterval);
          }
        }
        const rawHit = charged ? activeHit : normalHit;
        const appliedHit = Math.min(remainingHp, rawHit);
        remainingHp = Math.max(0, remainingHp - appliedHit);
        if (charged) {
          activeDamage += appliedHit;
          activeHitCount += 1;
        } else {
          normalDamage += appliedHit;
          normalHitCount += 1;
          if (sp.mode === 'attack') {
            storedSp = Math.min(
              storedCap,
              storedSp + Math.max(0, Number(sp.perAttack) || 0),
            );
          }
        }
        nextAttack += charged ? activeInterval : normalInterval;
        if (remainingHp <= epsilon) {
          killTime = time;
          break;
        }
      }
      lastTime = time;
      if (remainingHp <= epsilon) break;
    }

    const totalDamage = normalDamage + activeDamage;
    const measuredTime = Number((killTime ?? time).toFixed(6));
    const totalHits = normalHitCount + activeHitCount;
    return {
      effectiveAttack,
      normalInterval,
      activeInterval: normalInterval,
      normalDph,
      skillDph,
      normalHit,
      activeHit,
      normalDps: normalTime > 0 ? normalDamage / normalTime : 0,
      activeDps:
        activeTime > 0
          ? activeDamage / activeTime
          : activeHitCount > 0
            ? activeDamage / (activeHitCount * activeInterval)
            : 0,
      cycleDps: measuredTime > 0 ? totalDamage / measuredTime : 0,
      dps: measuredTime > 0 ? totalDamage / measuredTime : 0,
      totalDamage,
      normalDamage,
      activeDamage,
      normalHits: normalHitCount,
      skillHits: activeHitCount,
      skillCasts,
      activeTime,
      normalTime,
      readyTime: skillCasts > 0 ? normalTime / skillCasts : 0,
      skillUptime:
        duration > epsilon
          ? measuredTime > 0
            ? activeTime / measuredTime
            : 0
          : totalHits > 0
            ? activeHitCount / totalHits
            : 0,
      ticks: Math.round(measuredTime / step),
      killTime: killTime === null ? null : measuredTime,
      remainingHp,
      horizon,
      tick: step,
      storedSp,
      chargesAvailable: Math.floor(storedSp / cost),
      blockSeconds: Math.min(blockSeconds, normalInterval),
      spPerSecond: Math.max(0, Number(sp.perSecond) || 0),
      spCost: cost,
      maxCharges,
    };
  }

  let time = 0;
  let nextAttack = normalInterval;
  let readyTimer = Math.max(0, cooldown);
  let activeRemaining = 0;
  let normalTime = 0;
  let activeTime = 0;
  let normalDamage = 0;
  let activeDamage = 0;
  let normalHitCount = 0;
  let activeHitCount = 0;
  let skillCasts = 0;
  let remainingHp = Number.isFinite(enemy.hp)
    ? Math.max(0, enemy.hp)
    : Infinity;
  let killTime = null;

  for (let frame = 0; frame < maxTicks && time < horizon; frame += 1) {
    const dt = Math.min(step, horizon - time);
    time += dt;

    if (activeRemaining > 0) {
      activeTime += dt;
      activeRemaining = Math.max(0, activeRemaining - dt);
      if (activeRemaining <= epsilon) {
        activeRemaining = 0;
        readyTimer = Math.max(0, cooldown);
      }
    } else {
      normalTime += dt;
      readyTimer = Math.max(0, readyTimer - dt);
    }

    while (nextAttack <= time + epsilon && remainingHp > 0) {
      let isActive = activeRemaining > 0;
      if (!isActive && readyTimer <= epsilon) {
        skillCasts += 1;
        activeRemaining = Math.max(0, duration);
        readyTimer = Infinity;
        isActive = true;
      }
      const rawHit = isActive ? activeHit : normalHit;
      const appliedHit = Math.min(remainingHp, rawHit);
      remainingHp = Math.max(0, remainingHp - appliedHit);
      if (isActive) {
        activeDamage += appliedHit;
        activeHitCount += 1;
        if (duration <= epsilon) {
          activeRemaining = 0;
          readyTimer = Math.max(0, cooldown);
        }
      } else {
        normalDamage += appliedHit;
        normalHitCount += 1;
      }
      nextAttack += isActive ? activeInterval : normalInterval;
      if (remainingHp <= epsilon) {
        killTime = time;
        break;
      }
    }
    if (remainingHp <= epsilon) break;
  }

  const totalDamage = normalDamage + activeDamage;
  const measuredTime = killTime ?? time;
  const roundedTime = Number(measuredTime.toFixed(6));
  return {
    effectiveAttack,
    normalInterval,
    activeInterval,
    normalDph,
    skillDph,
    normalHit,
    activeHit,
    normalDps: normalTime > 0 ? normalDamage / normalTime : 0,
    activeDps:
      activeTime > 0
        ? activeDamage / activeTime
        : activeHitCount > 0
          ? activeDamage / (activeHitCount * activeInterval)
          : 0,
    cycleDps: roundedTime > 0 ? totalDamage / roundedTime : 0,
    dps: roundedTime > 0 ? totalDamage / roundedTime : 0,
    totalDamage,
    normalDamage,
    activeDamage,
    normalHits: normalHitCount,
    skillHits: activeHitCount,
    skillCasts,
    activeTime,
    normalTime,
    readyTime: Math.max(0, cooldown),
    skillUptime: roundedTime > 0 ? activeTime / roundedTime : 0,
    ticks: Math.round(roundedTime / step),
    killTime: killTime === null ? null : roundedTime,
    remainingHp,
    horizon,
    tick: step,
  };
}

function sharedBossHp(hp, roomSize) {
  const players = Math.max(1, Math.min(4, Math.floor(Number(roomSize) || 1)));
  return Math.max(0, Number(hp) || 0) * players;
}

function matchOperatorName(names, query) {
  const normalizedQuery = String(query ?? '').trim().toLocaleLowerCase('zh-CN');
  if (!normalizedQuery) return '';
  const normalized = names.map((name) => ({
    name,
    value: name.toLocaleLowerCase('zh-CN'),
  }));
  return (
    normalized.find((item) => item.value === normalizedQuery)?.name ??
    normalized.find((item) => item.value.startsWith(normalizedQuery))?.name ??
    normalized.find((item) => item.value.includes(normalizedQuery))?.name ??
    ''
  );
}

function evaluateAutoChessTrait(description = '', bondLayers = []) {
  const text = String(description ?? '');
  const totalLayers = bondLayers.reduce(
    (sum, value) => sum + Math.max(0, Number(value) || 0),
    0,
  );
  const spMatch = text.match(
    /每叠加\s*(\d+)\s*层[^。\n]*?技力自然回复速度\s*\+\s*([\d.]+)/,
  );
  const attackMatch = text.match(
    /每叠加\s*(\d+)\s*层[^。\n]*?攻击力\s*\+\s*(\d+(?:\.\d+)?)%/,
  );
  const aspdMatch = text.match(
    /每叠加\s*(\d+)\s*层[^。\n]*?攻击速度\s*\+\s*(\d+(?:\.\d+)?)/,
  );
  const rawAttackMatch = text.match(
    /攻击力和生命上限\s*\+\s*(\d+(?:\.\d+)?)%/,
  );
  const flatAttackMatch = text.match(
    /基础攻击力\s*\+\s*(\d+(?:\.\d+)?)/,
  );
  const step = Number(
    spMatch?.[1] ?? attackMatch?.[1] ?? aspdMatch?.[1] ?? 1,
  );
  const stacks = Math.floor(totalLayers / Math.max(1, step));
  return {
    totalLayers,
    stacks,
    effects: {
      spPerSecond: stacks * Number(spMatch?.[2] ?? 0),
      attackBonus:
        stacks * Number(attackMatch?.[2] ?? 0) +
        Number(rawAttackMatch?.[1] ?? 0),
      aspd: stacks * Number(aspdMatch?.[2] ?? 0),
      flatAttack: Number(flatAttackMatch?.[1] ?? 0),
    },
  };
}

function evaluateCovenant(bond, layer = 0, memberCount = 0, options = {}) {
  const currentLayer = Math.max(0, Number(layer) || 0);
  const currentMembers = Math.max(0, Number(memberCount) || 0);
  const boards = (bond.buffs ?? []).map((buff) => buff.Blackboard ?? {});
  const value = (index, key, fallback = 0) => {
    const raw = boards[index]?.[key];
    return Number.isFinite(Number(raw)) ? Number(raw) : fallback;
  };
  const effects = {
    attackBonus: 0,
    flatAttack: 0,
    activeAttackBonus: 0,
    aspd: 0,
    damageMultiplier: 1,
    defensePenetration: 0,
    resistancePenetration: 0,
    resistanceShred: 0,
    extraDamageMultiplier: 0,
    spCostMultiplier: 1,
    initialSp: 0,
    hpBonus: 0,
    defenseBonus: 0,
    damageReduction: 0,
    abnormal: null,
    blockedArtsScale: 0,
    skillDeployTrue: null,
    reflect: null,
    randomElement: null,
    enemyEpRecoverSpeed: 0,
    kjeragColdMultiplier: 1,
    egirDevour: false,
    egirDamageValue: 0,
    egirRespawns: 0,
  };
  const metrics = [];
  const add = (label, text) => metrics.push({ label, value: text });
  const roundValue = (input, places = 1) => {
    const scale = 10 ** places;
    return Math.round(input * scale) / scale;
  };
  const pct = (input) => `${roundValue(input * 100, 1)}%`;
  const num = (value, digits = 1) =>
    Number(value).toLocaleString('zh-CN', {
      maximumFractionDigits: digits,
    });

  switch (bond.bondId) {
    case 'yanShip': {
      const attack = value(0, 'atk_base') + value(0, 'atk_per_stack') * currentLayer;
      const extra = Math.min(
        value(0, 'ex_atk_scale_max', Infinity),
        value(0, 'ex_atk_scale_base') +
          value(0, 'ex_atk_scale_per_stack') * currentLayer,
      );
      const requiredMembers = value(0, 'power_bond_char_cnt');
      const recoverySpeed = Math.min(
        value(1, 'ep_break_recover_speed_max', Infinity),
        value(1, 'ep_break_recover_speed_base') +
          value(1, 'ep_break_recover_speed_per_stack') * currentLayer,
      );
      effects.attackBonus = attack * 100;
      add('攻击力', `+${pct(attack)}`);
      if (currentMembers >= requiredMembers) {
        effects.randomElement = {
          ratio: extra,
          types: ['灼燃', '凋亡', '侵蚀', '神经'],
        };
        effects.enemyEpRecoverSpeed = recoverySpeed;
        add('随机元素损伤', `${pct(extra)} 攻击力 / 次`);
        add('敌人爆条全局恢复', `+${pct(recoverySpeed)}`);
      } else {
        add('随机元素损伤', `需 ${num(requiredMembers, 0)} 名不同【炎】干员`);
      }
      break;
    }
    case 'sargonShip': {
      const aspd = value(0, 'base_attack_speed');
      const duration = value(0, 'base_time') + value(0, 'time_per_stack') * currentLayer;
      effects.aspd = aspd;
      add('开启技能时攻速', `+${num(aspd)}`);
      add('加成持续', `${num(duration)} 秒`);
      break;
    }
    case 'victoriaShip': {
      const multiplier = value(0, 'base_damage_scale') + value(0, 'damage_scale_per_stack') * currentLayer;
      effects.damageMultiplier = multiplier;
      add('伤害倍率', `×${num(multiplier, 3)}`);
      break;
    }
    case 'kjeragShip': {
      const normal = value(0, 'base_damage_scale');
      const frozen =
        value(0, 'base_ex_damage_scale') +
        value(0, 'ex_damage_scale_per_stack') * currentLayer;
      effects.damageMultiplier = options.enemyCold ? frozen : normal;
      effects.kjeragColdMultiplier = frozen;
      add('常态伤害倍率', `×${num(normal, 3)}`);
      add('对寒冷/冻结', `×${num(frozen, 3)}`);
      add('当前计算', options.enemyCold ? '按寒冷/冻结' : '按常态');
      break;
    }
    case 'egirShip': {
      const hp = value(0, 'base_max_hp') + value(0, 'max_hp_per_stack') * currentLayer;
      effects.hpBonus = hp * 100;
      effects.egirDevour = true;
      effects.egirDamageValue = value(0, 'damage_value');
      effects.egirRespawns =
        currentMembers >= value(0, 'power_bond_char_cnt')
          ? value(0, 'max_free_respawn_cnt')
          : 0;
      add('生命值', `+${pct(hp)}`);
      add('吞噬', '继承基础攻击力与阻挡数');
      if (effects.egirRespawns) {
        add('首次复活', `${num(effects.egirRespawns, 0)} 名`);
      }
      break;
    }
    case 'siracusaShip': {
      const aspd =
        value(0, 'base_attack_speed') +
        value(0, 'attack_speed_per_stack') * currentLayer;
      const duration =
        value(0, 'base_duration') +
        value(0, 'duration_per_stack') * currentLayer;
      const damage =
        value(0, 'damage_value_base') +
        value(0, 'damage_value_per_stack') * currentLayer;
      effects.aspd = aspd;
      add('部署后攻速', `+${num(aspd)}`);
      add('持续', `${num(duration)} 秒`);
      const needMembers = value(0, 'power_bond_char_cnt');
      const prob = value(0, 'prob');
      const abDuration = Math.min(
        value(0, 'ab_buff_duration_max'),
        value(0, 'ab_buff_duration_base') +
          value(0, 'ab_buff_duration_per_stack') * currentLayer,
      );
      if (currentMembers >= needMembers) {
        effects.abnormal = {
          prob,
          duration: abDuration,
          damage,
          cooldown: 0.2,
          types: ['stunned', 'feared', 'cold', 'palsy'],
        };
        add('异常真伤', `${num(damage)} / 秒 · ${pct(prob)} 触发`);
      } else {
        add('异常真伤', `需 ${num(needMembers, 0)} 名叙拉古干员`);
      }
      break;
    }
    case 'kazimierzShip': {
      const attack =
        value(0, 'base_max_atk_when_born') +
        value(0, 'max_atk_when_born_per_stack') * currentLayer;
      effects.attackBonus = attack * 100;
      add('攻击力上限', `+${pct(attack)}`);
      const trueScale = Math.min(
        value(0, 'ex_atk_scale_max'),
        value(0, 'ex_atk_scale_base') +
          value(0, 'ex_atk_scale_per_stack') * currentLayer,
      );
      const trueWindow = value(0, 'ex_damage_duration');
      if (currentMembers >= value(0, 'power_bond_char_cnt')) {
        effects.skillDeployTrue = { scale: trueScale, window: trueWindow };
        add('技能/部署真伤', `${pct(trueScale)} · ${num(trueWindow)} 秒`);
      } else {
        add('技能/部署真伤', `需 ${num(value(0, 'power_bond_char_cnt'), 0)} 人`);
      }
      break;
    }
    case 'ursusShip': {
      const attack =
        value(0, 'atk_base') + value(0, 'atk_per_stack') * currentLayer;
      const hp =
        value(0, 'hp_base') + value(0, 'hp_per_stack') * currentLayer;
      const blocked =
        value(0, 'atk_scale_base') +
        value(0, 'atk_scale_per_stack') * currentLayer;
      effects.attackBonus = attack * 100;
      effects.hpBonus = hp * 100;
      add('攻击力', `+${pct(attack)}`);
      add('生命值', `+${pct(hp)}`);
      if (currentMembers >= value(0, 'power_bond_char_cnt')) {
        effects.blockedArtsScale = blocked;
        add('阻挡法伤', `${pct(blocked)} 攻击力 / 秒`);
      } else {
        add('阻挡法伤', `需 ${num(value(0, 'power_bond_char_cnt'), 0)} 人`);
      }
      break;
    }
    case 'iberiaShip': {
      const dot =
        value(0, 'dot_atk_scale_base') +
        value(0, 'dot_atk_scale_per_stack') * currentLayer;
      effects.extraDamageMultiplier = dot;
      add('持续法术伤害', `${pct(dot)} 攻击力 / 秒`);
      add('弹射伤害', `${pct(value(0, 'atk_scale'))} 攻击力`);
      break;
    }
    case 'lethaniaShip': {
      const attack =
        value(0, 'atk_base') + value(0, 'atk_per_stack') * currentLayer;
      const bigChance = Math.min(
        value(0, 'big_prob_max'),
        value(0, 'big_prob_base') +
          value(0, 'big_prob_per_stack') * currentLayer,
      );
      effects.attackBonus = attack * 100;
      add('干员与召唤物攻击', `+${pct(attack)}`);
      add('乐部概率', pct(bigChance));
      break;
    }
    case 'preciShip': {
      const attack =
        value(0, 'base_atk') + value(0, 'atk_per_stack') * currentLayer;
      effects.attackBonus = attack * 100;
      if (currentMembers >= value(0, 'power_bond_char_cnt', 3)) {
        effects.defensePenetration = value(0, 'power_def_penetrate');
        effects.resistancePenetration = value(
          0,
          'power_magic_resist_penetrate',
        );
      }
      add('攻击力', `+${pct(attack)}`);
      add(
        '3名触发穿透',
        `防御 ${pct(effects.defensePenetration)} / 法抗 ${pct(effects.resistancePenetration)}`,
      );
      break;
    }
    case 'swiftShip': {
      const chance = Math.min(
        1,
        value(0, 'base_prob') + value(0, 'prob_per_stack') * currentLayer,
      );
      const sp = value(0, 'normal_sp');
      effects.initialSp = 0;
      add('技能结束回复', `${num(sp)} 技力 · ${pct(chance)} 概率`);
      if (currentLayer >= value(0, 'power_bond_stack_cnt', 40)) {
        add(
          '40层额外回复',
          `${num(value(0, 'power_sp'))} 技力 · 等概率`,
        );
      }
      break;
    }
    case 'skillfulShip': {
      const aspd =
        value(0, 'base_attack_speed') +
        value(0, 'attack_speed_per_stack') * currentLayer;
      effects.aspd = aspd;
      add('攻速', `+${num(aspd)}`);
      break;
    }
    case 'steadShip': {
      const hp =
        value(0, 'base_max_hp') +
        value(0, 'max_hp_per_stack') * currentLayer;
      const retaliation =
        value(0, 'base_damage_value') +
        value(0, 'damage_value_per_stack') * currentLayer;
      effects.hpBonus = hp * 100;
      effects.damageReduction = value(0, 'damage_resistance');
      effects.reflect = {
        damage: retaliation,
        cd: Math.max(0.05, value(0, 'cd_duration', 0.2)),
      };
      add('生命值', `+${pct(hp)}`);
      add('伤害分流', pct(value(0, 'damage_resistance')));
      add('反伤', `${num(retaliation)} 法术 / ${num(value(0, 'cd_duration', 0.2), 1)}秒`);
      break;
    }
    case 'deputShip': {
      const defense =
        value(0, 'base_def') + value(0, 'def_per_stack') * currentLayer;
      effects.defenseBonus = defense * 100;
      add('防御力', `+${pct(defense)}`);
      add('再部署时间', pct(value(0, 'respawn_time')));
      add(
        '休整期增层',
        currentMembers >= 3
          ? `+${num(value(1, 'more_layer'))}`
          : `+${num(value(1, 'layer'))}`,
      );
      break;
    }
    case 'visiShip': {
      add('每10层资金', `+${num(value(0, 'count'))}`);
      add('80层折扣', `-${num(value(1, 'discount'))} 资金`);
      break;
    }
    case 'miraShip': {
      const chance = Math.min(
        1,
        value(0, 'baseprob') + value(0, 'prob') * currentLayer,
      );
      add('免费刷新概率', pct(chance));
      break;
    }
    case 'investShip': {
      add(
        '获得时触发次数',
        currentLayer >= value(1, 'layer', 100)
          ? `${num(value(1, 'count'))} 次`
          : `${num(value(0, 'count'))} 次`,
      );
      break;
    }
    case 'raidShip': {
      const attack =
        value(0, 'base_atk') + value(0, 'atk_per_stack') * currentLayer;
      effects.activeAttackBonus = attack * 100;
      if (currentLayer >= value(0, 'power_bond_stack_cnt', 50)) {
        effects.aspd += value(0, 'power_attack_speed');
        add('全体攻速', `+${num(value(0, 'power_attack_speed'))}`);
      }
      add('突袭期间攻击力', `+${pct(attack)}`);
      break;
    }
    case 'indomShip': {
      const chance = Math.min(
        1,
        value(0, 'base_prob') + value(0, 'prob_per_stack') * currentLayer,
      );
      add('立即再部署概率', pct(chance));
      add('满3名额外', `全体 +${num(value(0, 'sp'))} 技力`);
      break;
    }
    case 'maniShip': {
      add('核心盟约激活人数', `+${num(value(0, 'count'))}`);
      break;
    }
    case 'emptyShip': {
      effects.damageMultiplier = value(0, 'damage_scale_normal');
      effects.damageReduction = value(0, 'damage_resistance');
      add('伤害倍率', `×${num(value(0, 'damage_scale_normal'), 2)}`);
      add('精锐伤害倍率', `×${num(value(0, 'damage_scale_extra'), 2)}`);
      add('物理/法术减伤', pct(value(0, 'damage_resistance')));
      break;
    }
    case 'soloShip': {
      effects.attackBonus = value(0, 'atk') * 100;
      effects.hpBonus = value(0, 'max_hp') * 100;
      effects.initialSp = value(0, 'sp');
      add('攻击力', `+${pct(value(0, 'atk'))}`);
      add('生命值', `+${pct(value(0, 'max_hp'))}`);
      add('初始技力', `+${num(value(0, 'sp'))}`);
      break;
    }
    case 'suntShip': {
      const powerAtk = value(0, 'power_atk');
      const spRatio = value(0, 'sp_ratio');
      if (options.elite) {
        effects.attackBonus = powerAtk * 100;
        effects.spCostMultiplier *= spRatio;
        add('精锐攻击力', `+${pct(powerAtk)}`);
        add('精锐技力消耗', `×${num(spRatio, 2)}`);
      } else {
        add('精锐攻击力', `+${pct(powerAtk)}（仅精锐状态）`);
        add('精锐技力消耗', `×${num(spRatio, 2)}（仅精锐状态）`);
      }
      break;
    }
    case 'docShip': {
      const heal =
        value(0, 'heal_base') + value(0, 'heal_per_stack') * currentLayer;
      const shield =
        value(0, 'damage_res_base') +
        value(0, 'damage_res_per_stack') * currentLayer;
      add('每秒治疗', `${pct(heal)} 攻击力`);
      add('庇护', pct(shield));
      break;
    }
    case 'arcaneShip': {
      const extra =
        value(0, 'atk_base') + value(0, 'atk_per_stack') * currentLayer;
      const shred = Math.min(
        Math.abs(value(1, 'magic_res_max_min', -100)),
        Math.abs(value(1, 'magic_res_max_base', -30)) +
          Math.abs(value(1, 'magic_res_max_per_stack', -0.05)) * currentLayer,
      );
      effects.extraDamageMultiplier = extra;
      effects.resistanceShred = shred;
      add('附加法术伤害', `${pct(extra)} 攻击力`);
      add('法抗削减上限', `-${num(shred)}`);
      break;
    }
    default:
      break;
  }

  return {
    bondId: bond.bondId,
    active: currentMembers >= (bond.activeCount ?? 0),
    layer: currentLayer,
    memberCount: currentMembers,
    effects,
    metrics,
  };
}

globalThis.ArkCalc = {
  damageAfterMitigation,
  calculateCycleDps,
  summarizeDamageMetrics,
  resolveAutochessEnemyStats,
  summarizeEnemyWaveHp,
  resolveOperatorStats,
  estimateSkillHints,
  inferDamageType,
  estimateEpBurstDps,
  estimateElementCycleDps,
  estimateSiracusaAbnormalDps,
  classifySkillOutput,
  mergeTalentEffects,
  calculateDpsModel,
  simulateFrameDps,
  sharedBossHp,
  matchOperatorName,
  evaluateAutoChessTrait,
  evaluateCovenant,
};
