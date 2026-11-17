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

function estimateSkillHints(description = '') {
  let attackMultiplier = 1;
  let match = description.match(/造成相当于攻击力\s*(\d+(?:\.\d+)?)%/);
  if (match) {
    attackMultiplier = Number(match[1]) / 100;
  } else if ((match = description.match(/攻击力提升至\s*(\d+(?:\.\d+)?)%/))) {
    attackMultiplier = Number(match[1]) / 100;
  } else if ((match = description.match(/攻击力(?:提升|增加|提高|\+)\s*(\d+(?:\.\d+)?)%/))) {
    attackMultiplier = 1 + Number(match[1]) / 100;
  }

  const interval = description.match(
    /攻击间隔[^。；，,]*[（(]\s*([-+]?\d+(?:\.\d+)?)\s*[）)]/,
  );
  const aspdMatch = description.match(/攻击速度\s*[+＋]\s*(\d+(?:\.\d+)?)/);
  const chargeMatch = description.match(/可充能\s*(\d+)\s*次/);

  return {
    attackMultiplier,
    intervalDelta: interval ? Number(interval[1]) : 0,
    aspd: aspdMatch ? Number(aspdMatch[1]) : 0,
    charges: chargeMatch ? Number(chargeMatch[1]) : 0,
    chargeBased: Boolean(chargeMatch),
  };
}

function inferDamageType(trait = '', skillDescription = '') {
  const text = `${skillDescription} ${trait}`;
  if (text.includes('真实伤害') || text.includes('元素伤害')) return 'true';
  if (text.includes('法术伤害')) return 'arts';
  return 'physical';
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
  const normalInterval = Math.max(0.05, baseInterval) / normalSpeedScale;
  const activeInterval =
    Math.max(0.05, baseInterval + intervalDelta) / activeSpeedScale;
  const defenseScale = 1 - Math.min(1, Math.max(0, defensePenetration));
  const resistanceScale =
    1 - Math.min(1, Math.max(0, resistancePenetration));
  const mitigatedEnemy = {
    def: Math.max(0, (enemy.def ?? 0) * defenseScale - defenseIgnore),
    res: Math.max(0, (enemy.res ?? 0) * resistanceScale - resistanceIgnore),
  };
  const normalHit =
    damageAfterMitigation(
      effectiveAttack * normalMultiplier,
      damageType,
      mitigatedEnemy,
    ) * Math.max(1, normalHits);
  const activeHit =
    damageAfterMitigation(
      effectiveAttack * activeMultiplier,
      damageType,
      mitigatedEnemy,
    ) * Math.max(1, skillHits);
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
  normalHits = 1,
  skillHits = 1,
  duration = 0,
  cooldown = 0,
  defenseIgnore = 0,
  resistanceIgnore = 0,
  defensePenetration = 0,
  resistancePenetration = 0,
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
  const normalInterval =
    Math.max(0.05, baseInterval) / normalSpeedScale;
  const activeInterval =
    Math.max(0.05, baseInterval + intervalDelta) / activeSpeedScale;
  const defenseScale = 1 - Math.min(1, Math.max(0, defensePenetration));
  const resistanceScale =
    1 - Math.min(1, Math.max(0, resistancePenetration));
  const mitigatedEnemy = {
    def: Math.max(0, (enemy.def ?? 0) * defenseScale - defenseIgnore),
    res: Math.max(0, (enemy.res ?? 0) * resistanceScale - resistanceIgnore),
  };
  const normalHit =
    damageAfterMitigation(
      effectiveAttack * normalMultiplier,
      damageType,
      mitigatedEnemy,
    ) * Math.max(1, normalHits);
  const activeHit =
    damageAfterMitigation(
      effectiveAttack * activeMultiplier,
      damageType,
      mitigatedEnemy,
    ) * Math.max(1, skillHits);

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
      normalHit,
      activeHit,
      normalDps: normalTime > 0 ? normalDamage / normalTime : 0,
      activeDps: activeTime > 0 ? activeDamage / activeTime : 0,
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
    normalHit,
    activeHit,
    normalDps: normalTime > 0 ? normalDamage / normalTime : 0,
    activeDps: activeTime > 0 ? activeDamage / activeTime : 0,
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
  const step = Number(
    spMatch?.[1] ?? attackMatch?.[1] ?? aspdMatch?.[1] ?? 1,
  );
  const stacks = Math.floor(totalLayers / Math.max(1, step));
  return {
    totalLayers,
    stacks,
    effects: {
      spPerSecond: stacks * Number(spMatch?.[2] ?? 0),
      attackBonus: stacks * Number(attackMatch?.[2] ?? 0),
      aspd: stacks * Number(aspdMatch?.[2] ?? 0),
    },
  };
}

function evaluateCovenant(bond, layer = 0, memberCount = 0) {
  const currentLayer = Math.max(0, Number(layer) || 0);
  const currentMembers = Math.max(0, Number(memberCount) || 0);
  const boards = (bond.buffs ?? []).map((buff) => buff.Blackboard ?? {});
  const value = (index, key, fallback = 0) => {
    const raw = boards[index]?.[key];
    return Number.isFinite(Number(raw)) ? Number(raw) : fallback;
  };
  const effects = {
    attackBonus: 0,
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
      const extra = value(0, 'ex_atk_scale_base');
      effects.attackBonus = attack * 100;
      effects.extraDamageMultiplier = extra;
      add('攻击力', `+${pct(attack)}`);
      add('元素附加伤害', pct(extra));
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
      effects.damageMultiplier = normal;
      add('常态伤害倍率', `×${num(normal, 3)}`);
      add('对寒冷/冻结', `×${num(frozen, 3)}`);
      break;
    }
    case 'egirShip': {
      const hp = value(0, 'base_max_hp') + value(0, 'max_hp_per_stack') * currentLayer;
      effects.hpBonus = hp * 100;
      add('生命值', `+${pct(hp)}`);
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
      add('异常真伤', `${num(damage)} / 秒`);
      break;
    }
    case 'kazimierzShip': {
      const attack =
        value(0, 'base_max_atk_when_born') +
        value(0, 'max_atk_when_born_per_stack') * currentLayer;
      effects.attackBonus = attack * 100;
      add('攻击力上限', `+${pct(attack)}`);
      add('技能/部署真伤', pct(value(0, 'ex_atk_scale_base')));
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
      add('阻挡法伤', `${pct(blocked)} 攻击力 / 秒`);
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
      add('生命值', `+${pct(hp)}`);
      add('伤害分流', pct(value(0, 'damage_resistance')));
      add('反伤', `${num(retaliation)} 法术`);
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
      add('精锐攻击力', `+${pct(value(0, 'power_atk'))}`);
      add('精锐技力消耗', `×${num(value(0, 'sp_ratio'), 2)}`);
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
  resolveOperatorStats,
  estimateSkillHints,
  inferDamageType,
  calculateDpsModel,
  simulateFrameDps,
  matchOperatorName,
  evaluateAutoChessTrait,
  evaluateCovenant,
};
