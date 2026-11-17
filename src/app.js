(() => {
  'use strict';

  const snapshot = window.ARK_OPERATOR_SNAPSHOT;
  const covenantSnapshot = window.ARK_COVENANT_SNAPSHOT;
  const enemySnapshot = window.ARK_ENEMY_SNAPSHOT;
  const equipmentSnapshot = window.ARK_EQUIPMENT_SNAPSHOT;
  const commandSnapshot = window.ARK_COMMANDS_SNAPSHOT;
  const traitSnapshot = window.ARK_AUTOCHESS_TRAITS_SNAPSHOT;
  const calc = window.ArkCalc;
  if (
    !snapshot?.operators?.length ||
    !covenantSnapshot?.covenants?.length ||
    !enemySnapshot?.enemies?.length ||
    !equipmentSnapshot?.equipment?.length ||
    !commandSnapshot?.commands?.length ||
    !traitSnapshot?.traits?.length ||
    !calc
  ) {
    document.body.innerHTML =
      '<p style="padding:40px;color:#ffb168">数据或计算模块加载失败，请确认 data/ 下的数据快照与 src/calc.js 位于正确位置。</p>';
    return;
  }

  const operators = snapshot.operators.filter(
    (operator) => operator.profession && operator.stats,
  );
  const operatorMap = new Map(operators.map((operator) => [operator.name, operator]));
  const covenants = covenantSnapshot.covenants;
  const covenantMap = new Map(covenants.map((bond) => [bond.bondId, bond]));
  const enemies = enemySnapshot.enemies;
  const enemyMap = new Map(enemies.map((enemy) => [enemy.enemyId, enemy]));
  const equipment = equipmentSnapshot.equipment;
  const equipmentMap = new Map(
    equipment.map((item) => [item.id, item]),
  );
  const commands = commandSnapshot.commands;
  const commandMap = new Map(
    commands.map((command) => [command.id, command]),
  );
  const traitMap = new Map(
    traitSnapshot.traits.map((trait) => [trait.charId, trait]),
  );
  const defaultEnemyId = 'enemy_9013_acstmk';
  const colorList = [
    { line: '#72ddc5', glow: 'rgba(114, 221, 197, .14)' },
    { line: '#ffb168', glow: 'rgba(255, 177, 104, .13)' },
    { line: '#78aaff', glow: 'rgba(120, 170, 255, .13)' },
  ];
  const damageTypes = {
    physical: '物理',
    arts: '法术',
    true: '真实',
  };
  const levelOrder = ['M3', 'M2', 'M1', '7', '6', '5', '4', '3', '2', '1'];
  const defaultCovenantIds = [
    'lethaniaShip',
    'preciShip',
    'skillfulShip',
    'arcaneShip',
    'visiShip',
  ];
  const state = {
    enemy: {
      def: enemyMap.get(defaultEnemyId)?.defense ?? 500,
      res: enemyMap.get(defaultEnemyId)?.resistance ?? 30,
      useStronghold: true,
      selectedId: defaultEnemyId,
    },
    axis: 'covenant',
    chartCovenantId: defaultCovenantIds[0],
    killLimit: 5,
    slots: [],
    equipment: {
      enabled: true,
    },
    commands: {
      enabled: false,
      selectedIds: [],
    },
    covenants: {
      enabled: true,
      selectedIds: [...defaultCovenantIds],
      settings: Object.fromEntries(
        covenants.map((bond) => [
          bond.bondId,
          {
            layer: bond.bondId === 'visiShip' ? 50 : 100,
            members: bond.activeCount,
          },
        ]),
      ),
    },
  };
  const number = new Intl.NumberFormat('zh-CN', {
    maximumFractionDigits: 0,
  });
  const decimal = new Intl.NumberFormat('zh-CN', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });

  const slotsElement = document.querySelector('#slots');
  const operatorSearchList = document.querySelector('#operator-search-list');
  const covenantPanel = document.querySelector('#covenant-panel');
  const covenantSummaryElement = document.querySelector('#covenant-summary');
  const covenantListElement = document.querySelector('#covenant-list');
  const covenantSelectedList = document.querySelector('#covenant-selected-list');
  const equipmentList = document.querySelector('#equipment-list');
  const equipmentSummary = document.querySelector('#equipment-summary');
  const commandList = document.querySelector('#command-list');
  const commandSummary = document.querySelector('#command-summary');
  const strongholdEnemyEnabled = document.querySelector(
    '#stronghold-enemy-enabled',
  );
  const strongholdEnemyPanel = document.querySelector(
    '#stronghold-enemy-panel',
  );
  const strongholdEnemySearch = document.querySelector(
    '#stronghold-enemy-search',
  );
  const strongholdEnemySelect = document.querySelector('#stronghold-enemy');
  const strongholdEnemyProfile = document.querySelector(
    '#stronghold-enemy-profile',
  );
  const chart = document.querySelector('#chart');
  const tooltip = document.querySelector('#tooltip');
  let chartModel = null;
  let lastResults = [];
  let chartControlTimer = null;

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function round(value, places = 3) {
    const scale = 10 ** places;
    return Math.round(value * scale) / scale;
  }

  function findOperator(slot) {
    return operatorMap.get(slot.operatorName) ?? operators[0];
  }

  function findSkill(slot, operator = findOperator(slot)) {
    return (
      operator.skills.find((skill) => skill.name === slot.skillName) ??
      operator.skills[0] ??
      null
    );
  }

  function findLevel(slot, skill = findSkill(slot)) {
    const levels = skill?.levels ?? {};
    return levels[slot.level] ?? levels.M3 ?? Object.values(levels).at(-1) ?? null;
  }

  function inferIgnore(module) {
    const text = `${module?.trait ?? ''} ${module?.upgradedTalent ?? ''}`;
    return {
      defenseIgnore: Number(text.match(/无视目标\s*(\d+)\s*点防御/)?.[1] ?? 0),
      resistanceIgnore: Number(text.match(/无视目标\s*(\d+)\s*点法术抗性/)?.[1] ?? 0),
    };
  }

  function createSlot(operatorName, skillName) {
    const operator = operatorMap.get(operatorName) ?? operators[0];
    const skill =
      operator.skills.find((item) => item.name === skillName) ?? operator.skills[0];
    const slot = {
      operatorName: operator.name,
      skillName: skill?.name ?? '',
      level: 'M3',
      support: true,
      trust: true,
      potential: 6,
      module: '',
      equipmentId: '',
      attackBonus: 0,
      normalMultiplier: 1,
      activeMultiplier: 1,
      aspd: 0,
      intervalDelta: 0,
      duration: 0,
      cooldown: 0,
      charges: 1,
      chargeBased: false,
      spCost: 0,
      spInitial: 0,
      spMode: 'natural',
      normalHits: 1,
      skillHits: 1,
      defenseIgnore: 0,
      resistanceIgnore: 0,
      damageType: 'physical',
    };
    syncAuto(slot);
    return slot;
  }

  function syncAuto(slot) {
    const operator = findOperator(slot);
    slot.operatorName = operator.name;
    if (!operator.skills.some((skill) => skill.name === slot.skillName)) {
      slot.skillName = operator.skills[0]?.name ?? '';
    }
    const skill = findSkill(slot, operator);
    if (!skill) {
      slot.activeMultiplier = 1;
      slot.aspd = 0;
      slot.intervalDelta = 0;
      slot.duration = 0;
      slot.cooldown = 0;
      slot.charges = 1;
      slot.chargeBased = false;
      slot.spCost = 0;
      slot.spInitial = 0;
      slot.spMode = 'natural';
      slot.damageType = calc.inferDamageType(operator.trait, '');
      return;
    }
    const levels = skill.levels ?? {};
    if (!levels[slot.level]) {
      slot.level = levelOrder.find((level) => levels[level]) ?? 'M3';
    }
    const level = levels[slot.level] ?? Object.values(levels).at(-1);
    const hints = calc.estimateSkillHints(level?.description ?? '');
    slot.activeMultiplier = round(hints.attackMultiplier);
    slot.aspd = hints.aspd;
    slot.intervalDelta = hints.intervalDelta;
    slot.duration = level?.duration ?? 0;
    slot.charges = hints.charges || 1;
    slot.chargeBased = Boolean(hints.chargeBased);
    slot.spCost = level?.cost ?? 0;
    slot.spInitial = level?.initial ?? 0;
    slot.spMode =
      skill.skillType === '攻击回复'
        ? 'attack'
        : skill.skillType === '自动回复'
          ? 'natural'
          : 'none';
    slot.cooldown = Math.max(
      0,
      (level?.cost ?? 0) - (level?.initial ?? 0),
    );
    slot.damageType = calc.inferDamageType(
      operator.trait,
      level?.description ?? '',
    );
    const selectedModule = operator.modules.find(
      (module) => module.name === slot.module,
    );
    const ignore = inferIgnore(selectedModule);
    slot.defenseIgnore = ignore.defenseIgnore;
    slot.resistanceIgnore = ignore.resistanceIgnore;
  }

  function operatorOptions(selected) {
    const groups = [6, 5, 4, 3, 2, 1].map((rarity) => {
      const rows = operators
        .filter((operator) => operator.rarity === rarity)
        .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
        .map(
          (operator) =>
            `<option value="${escapeHtml(operator.name)}"${
              operator.name === selected ? ' selected' : ''
            }>${escapeHtml(operator.name)} · ${escapeHtml(operator.branch)}</option>`,
        )
        .join('');
      return rows ? `<optgroup label="${rarity}★">${rows}</optgroup>` : '';
    });
    return groups.join('');
  }

  function levelOptions(skill, selected) {
    return levelOrder
      .filter((level) => skill?.levels?.[level])
      .map(
        (level) =>
          `<option value="${level}"${level === selected ? ' selected' : ''}>${level}</option>`,
      )
      .join('');
  }

  function skillOptions(operator, selected) {
    return operator.skills
      .map(
        (skill, index) =>
          `<option value="${escapeHtml(skill.name)}"${
            skill.name === selected ? ' selected' : ''
          }>${index + 1}. ${escapeHtml(skill.name)}</option>`,
      )
      .join('');
  }

  function moduleOptions(operator, selected) {
    return [
      '<option value="">无模组</option>',
      ...operator.modules.map(
        (module) =>
          `<option value="${escapeHtml(module.name)}"${
            module.name === selected ? ' selected' : ''
          }>${escapeHtml(module.name)}</option>`,
      ),
    ].join('');
  }

  function equipmentGrade(item) {
    return item.id.endsWith('_b') ? 'II' : item.id.endsWith('_c') ? 'III' : 'I';
  }

  function equipmentOptions(selected) {
    const groups = new Map();
    for (const item of equipment) {
      const group = item.bondName || '通用 / 特殊';
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group).push(item);
    }
    return [
      '<option value="">无卫戍装备</option>',
      ...[...groups.entries()].map(
        ([group, items]) =>
          `<optgroup label="${escapeHtml(group)}">${items
            .map(
              (item) =>
                `<option value="${escapeHtml(item.id)}"${
                  item.id === selected ? ' selected' : ''
                }>${escapeHtml(item.name)} · ${equipmentGrade(item)}</option>`,
            )
            .join('')}</optgroup>`,
      ),
    ].join('');
  }

  function emptyReferenceEffects() {
    return {
      attackBonus: 0,
      aspd: 0,
      extraDamageMultiplier: 0,
      defensePenetration: 0,
      resistancePenetration: 0,
      spCostMultiplier: 1,
    };
  }

  function mergeReferenceStats(effects, stats = {}) {
    effects.attackBonus += stats.attackBonus ?? 0;
    effects.aspd += stats.aspd ?? 0;
    effects.extraDamageMultiplier +=
      stats.extraDamageMultiplier ?? 0;
    effects.defensePenetration = Math.max(
      effects.defensePenetration,
      stats.defensePenetration ?? 0,
    );
    effects.resistancePenetration = Math.max(
      effects.resistancePenetration,
      stats.resistancePenetration ?? 0,
    );
    effects.spCostMultiplier *= stats.spCostMultiplier ?? 1;
  }

  function combineReferenceEffects(slot) {
    const effects = emptyReferenceEffects();
    const appliedCommands = state.commands.selectedIds
      .map((id) => commandMap.get(id))
      .filter(Boolean);
    const selectedEquipment =
      state.equipment.enabled && equipmentMap.get(slot.equipmentId);
    if (selectedEquipment) {
      mergeReferenceStats(effects, selectedEquipment.autoStats);
    }
    if (state.commands.enabled) {
      for (const command of appliedCommands) {
        mergeReferenceStats(effects, command.autoStats);
      }
    }
    return {
      effects,
      equipment: selectedEquipment || null,
      commands: state.commands.enabled ? appliedCommands : [],
    };
  }

  function combineAutoChessTrait(slot) {
    const operator = findOperator(slot);
    const trait = traitMap.get(operator.id);
    if (!trait) {
      return {
        trait: null,
        totalLayers: 0,
        stacks: 0,
        effects: { spPerSecond: 0, attackBonus: 0, aspd: 0 },
      };
    }
    const selected = new Set(
      state.covenants.enabled ? state.covenants.selectedIds : [],
    );
    const layers = trait.bondIds
      .filter((bondId) => selected.has(bondId))
      .map(
        (bondId) =>
          state.covenants.settings[bondId]?.layer ?? 0,
      );
    return {
      trait,
      ...calc.evaluateAutoChessTrait(trait.description, layers),
    };
  }

  function covenantTypeLabel(bond) {
    return bond.bondType === 2 ? '核心' : '附加 / 特殊';
  }

  function covenantText(value) {
    return String(value ?? '').replace(/\{\d+:[^}]+\}/g, '动态值');
  }

  function selectedBonds() {
    return state.covenants.selectedIds
      .map((bondId) => covenantMap.get(bondId))
      .filter(Boolean);
  }

  function focusedCovenant() {
    const bands = selectedBonds();
    let bond = bands.find((item) => item.bondId === state.chartCovenantId);
    if (!bond && bands.length) {
      bond = bands[0];
      state.chartCovenantId = bond.bondId;
    }
    return bond ?? null;
  }

  function bondMatchesOperator(bond, operator) {
    return bond.members.some(
      (member) => member.charId === operator.id || member.name === operator.name,
    );
  }

  function combineCovenantEffects(slot, layerCap = null) {
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
    const applied = [];
    if (!state.covenants.enabled) {
      return { effects, applied };
    }
    const operator = findOperator(slot);

    for (const bond of selectedBonds()) {
      const settings = state.covenants.settings[bond.bondId];
      if (!settings || !bondMatchesOperator(bond, operator)) continue;
      const effectiveLayer =
        layerCap === null || bond.bondId !== state.chartCovenantId
          ? settings.layer
          : Math.min(settings.layer, Math.max(0, layerCap));
      if (
        layerCap !== null &&
        bond.bondId === state.chartCovenantId &&
        effectiveLayer <= 0
      ) {
        continue;
      }
      const evaluation = calc.evaluateCovenant(
        bond,
        effectiveLayer,
        settings.members,
      );
      if (!evaluation.active) continue;
      const item = evaluation.effects;
      effects.attackBonus += item.attackBonus;
      effects.activeAttackBonus += item.activeAttackBonus;
      effects.aspd += item.aspd;
      effects.damageMultiplier *= item.damageMultiplier;
      effects.defensePenetration = Math.max(
        effects.defensePenetration,
        item.defensePenetration,
      );
      effects.resistancePenetration = Math.max(
        effects.resistancePenetration,
        item.resistancePenetration,
      );
      effects.resistanceShred += item.resistanceShred;
      effects.extraDamageMultiplier += item.extraDamageMultiplier;
      effects.spCostMultiplier *= item.spCostMultiplier;
      effects.initialSp += item.initialSp;
      effects.hpBonus += item.hpBonus;
      effects.defenseBonus += item.defenseBonus;
      effects.damageReduction = Math.max(
        effects.damageReduction,
        item.damageReduction,
      );
      applied.push({ bond, evaluation });
    }
    effects.resistanceShred = Math.min(100, effects.resistanceShred);
    return { effects, applied };
  }

  function renderCovenantBrowser() {
    const query = document.querySelector('#covenant-search').value.trim();
    const type = document.querySelector('#covenant-filter').value;
    const selected = new Set(state.covenants.selectedIds);
    const filtered = covenants.filter((bond) => {
      if (type !== 'all' && String(bond.bondType) !== type) return false;
      if (!query) return true;
      const text = [
        bond.name,
        bond.bondId,
        bond.description,
        ...bond.members.map((member) => member.name),
      ]
        .join(' ')
        .toLowerCase();
      return text.includes(query.toLowerCase());
    });

    covenantListElement.innerHTML = filtered
      .map(
        (bond) => `
          <button class="covenant-card ${selected.has(bond.bondId) ? 'selected' : ''} ${bond.bondType === 2 ? 'core' : 'extra'}"
            type="button" data-covenant-pick="${escapeHtml(bond.bondId)}">
            <span class="covenant-card-top">
              <b>${escapeHtml(bond.name)}</b>
              <i>${covenantTypeLabel(bond)}</i>
            </span>
            <span class="covenant-card-meta">${bond.activeCount} 人激活 · ${bond.members.length} 名成员</span>
            <span class="covenant-card-desc">${escapeHtml(covenantText(bond.description))}</span>
          </button>`,
      )
      .join('');
    if (!filtered.length) {
      covenantListElement.innerHTML =
        '<p class="covenant-empty">没有匹配的盟约。</p>';
    }
  }

  function effectChips(effects) {
    const chips = [];
    if (effects.attackBonus) chips.push(`+${decimal.format(effects.attackBonus)}% 攻击`);
    if (effects.activeAttackBonus) chips.push(`技能期 +${decimal.format(effects.activeAttackBonus)}% 攻击`);
    if (effects.aspd) chips.push(`+${decimal.format(effects.aspd)} 攻速`);
    if (effects.damageMultiplier !== 1) chips.push(`伤害 ×${decimal.format(effects.damageMultiplier)}`);
    if (effects.defensePenetration) chips.push(`无视 ${decimal.format(effects.defensePenetration * 100)}% 防御`);
    if (effects.resistancePenetration) chips.push(`无视 ${decimal.format(effects.resistancePenetration * 100)}% 法抗`);
    if (effects.resistanceShred) chips.push(`法抗 -${decimal.format(effects.resistanceShred)}`);
    if (effects.extraDamageMultiplier) chips.push(`附加 ${decimal.format(effects.extraDamageMultiplier * 100)}% 攻击`);
    if (effects.initialSp) chips.push(`初始技力 +${decimal.format(effects.initialSp)}`);
    return chips;
  }

  function renderSelectedCovenants() {
    const bonds = selectedBonds();
    document.querySelector('#selected-count').textContent =
      `${bonds.length} / ${covenants.length}`;
    covenantSelectedList.innerHTML = bonds
      .map((bond) => {
        const settings = state.covenants.settings[bond.bondId];
        const evaluation = calc.evaluateCovenant(
          bond,
          settings.layer,
          settings.members,
        );
        const metrics = evaluation.metrics
          .map(
            (metric) =>
              `<span><small>${escapeHtml(metric.label)}</small><b>${escapeHtml(metric.value)}</b></span>`,
          )
          .join('');
        const params = bond.buffs
          .map((buff) => {
            const values = Object.entries(buff.Blackboard ?? {})
              .filter(([key]) => key !== 'key')
              .map(([key, value]) => `${key}=${value}`)
              .join(' · ');
            return `<p><code>${escapeHtml(buff.Key)}</code> ${escapeHtml(values)}</p>`;
          })
          .join('');
        return `
          <article class="selected-covenant ${evaluation.active ? 'active' : 'inactive'}" data-selected-bond="${escapeHtml(bond.bondId)}">
            <div class="selected-covenant-head">
              <div>
                <span>${covenantTypeLabel(bond)} · ${bond.activeCount} 人激活</span>
                <h4>${escapeHtml(bond.name)}</h4>
              </div>
              <button type="button" data-covenant-remove="${escapeHtml(bond.bondId)}" aria-label="移除${escapeHtml(bond.name)}">×</button>
            </div>
            <div class="covenant-sliders">
              <label>
                <span>层数 <output>${settings.layer}</output></span>
                <input type="range" min="0" max="999" step="1" value="${settings.layer}" data-covenant-layer="${escapeHtml(bond.bondId)}">
              </label>
              <label>
                <span>激活人数 <output>${settings.members}</output></span>
                <input type="range" min="0" max="12" step="1" value="${settings.members}" data-covenant-members="${escapeHtml(bond.bondId)}">
              </label>
            </div>
            <div class="covenant-metrics">${metrics || '<span>该效果暂无自动数值摘要</span>'}</div>
            <p class="selected-covenant-desc">${escapeHtml(covenantText(bond.effectDescription || bond.description))}</p>
            <details>
              <summary>精确参数与成员</summary>
              <div class="covenant-params">${params}</div>
              <p class="covenant-members">${escapeHtml(
                bond.members.map((member) => member.name).join('、') ||
                  '由金色或特殊状态触发',
              )}</p>
            </details>
          </article>`;
      })
      .join('');
    if (!bonds.length) {
      covenantSelectedList.innerHTML =
        '<p class="covenant-empty">从左侧选择盟约开始计算。</p>';
    }
  }

  function renderCovenantSummary() {
    const slots = state.slots.map((slot, index) => {
      const operator = findOperator(slot);
      const combined = combineCovenantEffects(slot);
      const chips = effectChips(combined.effects);
      return `
        <article class="covenant-applicant" style="--slot-color:${colorList[index].line}">
          <span>方案 ${String.fromCharCode(65 + index)}</span>
          <strong>${escapeHtml(operator.name)}</strong>
          <p>${chips.length ? chips.map((chip) => `<i>${escapeHtml(chip)}</i>`).join('') : '未命中已选盟约'}</p>
        </article>`;
    });
    const active = selectedBonds().filter((bond) => {
      const settings = state.covenants.settings[bond.bondId];
      return settings.members >= bond.activeCount;
    }).length;
    covenantSummaryElement.innerHTML = `
      <article><span>已选盟约</span><strong>${state.covenants.selectedIds.length}</strong><small>共 ${covenants.length} 条</small></article>
      <article><span>达到激活</span><strong>${active}</strong><small>人数条件已满足</small></article>
      ${slots.join('')}`;
  }

  function syncCovenantPanel() {
    document.querySelector('#covenants-enabled').checked =
      state.covenants.enabled;
    covenantPanel.classList.toggle('active', state.covenants.enabled);
  }

  function renderCovenants() {
    syncCovenantPanel();
    renderCovenantBrowser();
    renderSelectedCovenants();
    renderCovenantSummary();
    renderChartCovenantControls();
  }

  function renderChartCovenantControls() {
    const container = document.querySelector('#chart-covenant-controls');
    const bonds = selectedBonds();
    const focused = focusedCovenant();
    if (!bonds.length) {
      container.innerHTML =
        '<h3>横轴盟约</h3><p>当前没有可分析的盟约。</p>';
      return;
    }
    container.innerHTML = `
      <h3>横轴盟约</h3>
      <p>选择一条盟约扫描层数，其他盟约保持当前值不变。</p>
      <div class="chart-covenant-list">
        ${bonds
          .map((bond) => {
            const layer =
              state.covenants.settings[bond.bondId]?.layer ?? 0;
            const isFocused = bond.bondId === focused?.bondId;
            const matchedSlots = state.slots.flatMap((slot, index) =>
              bondMatchesOperator(bond, findOperator(slot)) ? [index] : [],
            );
            return `
              <article class="chart-covenant-row ${isFocused ? 'focused' : ''}">
                <div class="chart-covenant-choice">
                  <label>
                    <input type="radio" name="chart-covenant-axis" value="${escapeHtml(bond.bondId)}"${isFocused ? ' checked' : ''}>
                    <span>${escapeHtml(bond.name)}</span>
                  </label>
                  <span class="chart-layer-input">
                    <input class="chart-covenant-number" type="number" min="0" max="999" step="1" value="${layer}" data-chart-covenant-layer="${escapeHtml(bond.bondId)}" aria-label="${escapeHtml(bond.name)}层数输入">
                    <small>层</small>
                  </span>
                </div>
                <input type="range" min="0" max="999" step="1" value="${layer}" data-chart-covenant-layer="${escapeHtml(bond.bondId)}" aria-label="${escapeHtml(bond.name)}层数">
                <small class="chart-covenant-impact">${
                  matchedSlots.length
                    ? `作用于方案 ${matchedSlots.map((index) => String.fromCharCode(65 + index)).join('/')}`
                    : '不影响当前方案'
                }</small>
              </article>`;
          })
          .join('')}
      </div>
      <p class="chart-covenant-note">横轴范围会随所选盟约的当前层数切换；调整滑块会同时更新正式推演。</p>`;
  }

  function resetCovenants() {
    state.covenants.enabled = true;
    state.covenants.selectedIds = [...defaultCovenantIds];
    state.chartCovenantId = defaultCovenantIds[0];
    state.covenants.settings = Object.fromEntries(
      covenants.map((bond) => [
        bond.bondId,
        {
          layer: bond.bondId === 'visiShip' ? 50 : 100,
          members: bond.activeCount,
        },
      ]),
    );
  }

  function referenceStatChips(stats = {}) {
    const chips = [];
    const signed = (value, suffix = '') =>
      `${value > 0 ? '+' : ''}${decimal.format(value)}${suffix}`;
    if (stats.attackBonus) {
      chips.push(`攻击 ${signed(stats.attackBonus, '%')}`);
    }
    if (stats.aspd) chips.push(`攻速 ${signed(stats.aspd)}`);
    if (stats.extraDamageMultiplier) {
      chips.push(
        `附加 ${signed(stats.extraDamageMultiplier * 100, '%')}`,
      );
    }
    if (stats.defensePenetration) {
      chips.push(
        `无视 ${decimal.format(stats.defensePenetration * 100)}% 防御`,
      );
    }
    if (stats.resistancePenetration) {
      chips.push(
        `无视 ${decimal.format(stats.resistancePenetration * 100)}% 法抗`,
      );
    }
    if (
      Number.isFinite(stats.spCostMultiplier) &&
      stats.spCostMultiplier !== 1
    ) {
      chips.push(
        `技力消耗 ${signed((stats.spCostMultiplier - 1) * 100, '%')}`,
      );
    }
    return chips;
  }

  function parameterText(parameters) {
    const rows = (parameters ?? []).filter(
      (board) => board && Object.keys(board).length,
    );
    return rows.length ? JSON.stringify(rows) : '该效果没有 Blackboard 参数';
  }

  function slotEquipmentIndexes(equipmentId) {
    return state.slots.flatMap((slot, index) =>
      slot.equipmentId === equipmentId ? [index] : [],
    );
  }

  function renderEquipment() {
    const query = document
      .querySelector('#equipment-search')
      .value.trim()
      .toLocaleLowerCase('zh-CN');
    const filter = document.querySelector('#equipment-filter').value;
    const filtered = equipment.filter((item) => {
      const matchesFilter = filter === 'all' || item.bondId === filter;
      const haystack =
        `${item.name} ${item.description} ${item.bondName}`.toLocaleLowerCase(
          'zh-CN',
        );
      return matchesFilter && (!query || haystack.includes(query));
    });
    equipmentList.innerHTML =
      filtered
        .map((item) => {
          const assigned = slotEquipmentIndexes(item.id);
          const chips = referenceStatChips(item.autoStats);
          const assignmentButtons = state.slots
            .map((slot, index) => {
              const active = slot.equipmentId === item.id;
              return `<button type="button" data-equipment-assign="${escapeHtml(item.id)}" data-target="${index}" aria-pressed="${active}">方案 ${String.fromCharCode(65 + index)}</button>`;
            })
            .join('');
          return `
            <article id="equipment-${escapeHtml(item.id)}" class="reference-card ${assigned.length ? 'applied' : ''}">
              <div class="reference-card-head">
                <h3>${escapeHtml(item.name)} <small>${equipmentGrade(item)}</small></h3>
                <span>${escapeHtml(item.bondName || '通用')}</span>
              </div>
              <p class="reference-description">${escapeHtml(item.description)}</p>
              <div class="reference-meta">
                <span>${item.price} 资金</span>
                <span>${item.duration > 0 ? `${item.duration} 秒` : '常驻'}</span>
                ${item.golden ? '<span>进阶装备</span>' : ''}
                ${item.canFuse ? '<span>可融合</span>' : ''}
              </div>
              <div class="reference-stats">${
                chips.length
                  ? chips.map((chip) => `<span>${escapeHtml(chip)}</span>`).join('')
                  : '<span>复杂效果：保留原文，不自动折算</span>'
              }</div>
              <div class="reference-assign">
                <button type="button" data-equipment-assign="${escapeHtml(item.id)}" data-target="all">全部方案</button>
                ${assignmentButtons}
                <button class="clear" type="button" data-equipment-assign="${escapeHtml(item.id)}" data-target="clear">清除</button>
              </div>
              <details>
                <summary>原始 Blackboard 参数</summary>
                <code>${escapeHtml(parameterText(item.parameters))}</code>
              </details>
            </article>`;
        })
        .join('') ||
      '<p class="reference-empty">没有匹配的装备。</p>';
    document.querySelector('#equipment-count').textContent =
      `${filtered.length} / ${equipment.length} 件`;
    renderReferenceSummaries();
  }

  function renderCommands() {
    const query = document
      .querySelector('#command-search')
      .value.trim()
      .toLocaleLowerCase('zh-CN');
    const filter = document.querySelector('#command-filter').value;
    const selected = new Set(state.commands.selectedIds);
    const filtered = commands.filter((command) => {
      const matchesFilter =
        filter === 'all' || String(command.type) === filter;
      const haystack =
        `${command.name} ${command.description} ${command.bandName}`.toLocaleLowerCase(
          'zh-CN',
        );
      return matchesFilter && (!query || haystack.includes(query));
    });
    commandList.innerHTML =
      filtered
        .map((command) => {
          const applied = selected.has(command.id);
          const chips = referenceStatChips(command.autoStats);
          const availability =
            command.availability > 0
              ? `可用 ${command.availability} 次`
              : '条件触发 / 持续生效';
          return `
            <article id="command-${escapeHtml(command.id)}" class="reference-card ${applied ? 'applied' : ''}">
              <div class="reference-card-head">
                <h3>${escapeHtml(command.name)}</h3>
                <span>${escapeHtml(command.typeLabel)}</span>
              </div>
              <p class="reference-description">${escapeHtml(command.description)}</p>
              <div class="reference-meta">
                <span>${escapeHtml(command.bandName || '通用')}</span>
                <span>${command.cost} 资金</span>
                <span>${escapeHtml(availability)}</span>
                <span>${escapeHtml(command.targetLabel)}</span>
              </div>
              <div class="reference-stats">${
                chips.length
                  ? chips.map((chip) => `<span>${escapeHtml(chip)}</span>`).join('')
                  : '<span>复杂效果：保留原文，不自动折算</span>'
              }</div>
              <div class="reference-assign">
                <button type="button" data-command-toggle="${escapeHtml(command.id)}" aria-pressed="${applied}">${applied ? '取消启用' : '启用效果'}</button>
              </div>
              <details>
                <summary>原始 Blackboard 参数</summary>
                <code>${escapeHtml(parameterText(command.parameters))}</code>
              </details>
            </article>`;
        })
        .join('') ||
      '<p class="reference-empty">没有匹配的指令。</p>';
    document.querySelector('#command-count').textContent =
      `${filtered.length} / ${commands.length} 条`;
    renderReferenceSummaries();
  }

  function renderReferenceSummaries() {
    const equipmentRows = state.slots.map((slot, index) => {
      const item = equipmentMap.get(slot.equipmentId);
      return `<span>方案 ${String.fromCharCode(65 + index)} <b>${escapeHtml(item?.name ?? '未装备')}</b></span>`;
    });
    equipmentSummary.innerHTML = [
      `<span>装备修正 <b>${state.equipment.enabled ? '启用' : '停用'}</b></span>`,
      ...equipmentRows,
      '<span>自动值按常驻或基础层折算</span>',
    ].join('');
    const selected = state.commands.selectedIds
      .map((id) => commandMap.get(id))
      .filter(Boolean);
    const combined = emptyReferenceEffects();
    for (const command of selected) {
      mergeReferenceStats(combined, command.autoStats);
    }
    const chips = referenceStatChips(combined);
    commandSummary.innerHTML = [
      `<span>指令修正 <b>${state.commands.enabled ? '启用' : '停用'}</b></span>`,
      `<span>已选 <b>${selected.length}</b> 条</span>`,
      selected.length
        ? `<span>${escapeHtml(selected.map((item) => item.name).join('、'))}</span>`
        : '<span>尚未启用指令</span>',
      '<span>自动值按常驻或基础层折算</span>',
      ...chips.map((chip) => `<span>${escapeHtml(chip)}</span>`),
    ].join('');
  }

  function renderReferences() {
    document.querySelector('#equipment-enabled').checked =
      state.equipment.enabled;
    document.querySelector('#commands-enabled').checked =
      state.commands.enabled;
    renderEquipment();
    renderCommands();
  }

  function initReferenceFilters() {
    const bonds = [
      ...new Map(
        equipment
          .filter((item) => item.bondId)
          .map((item) => [item.bondId, item.bondName || item.bondId]),
      ).entries(),
    ].sort((a, b) => a[1].localeCompare(b[1], 'zh-CN'));
    document.querySelector('#equipment-filter').innerHTML = [
      '<option value="all">全部装备</option>',
      ...bonds.map(
        ([id, name]) =>
          `<option value="${escapeHtml(id)}">${escapeHtml(name)}</option>`,
      ),
    ].join('');
  }

  function enemyCategoryLabel(enemy) {
    if (enemy.category === 'boss') return '卫戍领袖';
    if (enemy.category === 'special') {
      return `卫戍特训${enemy.specialType ? ` · ${enemy.specialType}` : ''}`;
    }
    return '卫戍常规敌人';
  }

  function renderStrongholdEnemyOptions() {
    const query = strongholdEnemySearch.value.trim().toLowerCase();
    const visible = enemies.filter(
      (enemy) =>
        !query ||
        enemy.name.toLowerCase().includes(query) ||
        enemy.enemyId.toLowerCase().includes(query),
    );
    const groups = [
      ['boss', '领袖'],
      ['special', '特训 / 特殊'],
      ['regular', '常规敌人'],
    ].map(([category, label]) => {
      const rows = visible
        .filter((enemy) => enemy.category === category)
        .map(
          (enemy) =>
            `<option value="${escapeHtml(enemy.enemyId)}">${escapeHtml(enemy.name)} · ${number.format(enemy.defense)} 防 / ${decimal.format(enemy.resistance)}% 抗</option>`,
        )
        .join('');
      return rows ? `<optgroup label="${label}">${rows}</optgroup>` : '';
    });
    strongholdEnemySelect.innerHTML =
      groups.join('') || '<option value="">没有匹配敌人</option>';
    if (enemyMap.has(state.enemy.selectedId)) {
      strongholdEnemySelect.value = state.enemy.selectedId;
    } else if (visible.length) {
      strongholdEnemySelect.value = visible[0].enemyId;
    }
  }

  function renderStrongholdEnemyProfile() {
    const enemy = enemyMap.get(state.enemy.selectedId);
    if (!enemy) {
      strongholdEnemyProfile.innerHTML = '<span>未选择敌人</span>';
      return;
    }
    strongholdEnemyProfile.innerHTML = `
      <strong>${escapeHtml(enemy.name)}</strong>
      <span>终极模拟 · ${escapeHtml(enemyCategoryLabel(enemy))} · ${escapeHtml(enemy.enemyIndex || enemy.enemyId)}</span>
      <div>
        <i>生命 ${number.format(enemy.hp ?? 0)}</i>
        <i>攻击 ${number.format(enemy.attack ?? 0)}</i>
        <i>防御 ${number.format(enemy.defense)}</i>
        <i>法抗 ${decimal.format(enemy.resistance)}%</i>
      </div>
      <details class="enemy-factor-details">
        <summary>终极数值来源</summary>
        <p>模式生命/攻击/防御 ×${enemy.ultimate?.modeFactor ?? 1}；攻击 ×${enemy.ultimate?.attackFactor ?? 1}；防御 ×${enemy.ultimate?.defenseFactor ?? 1}；法抗 ×${enemy.ultimate?.resistanceFactor ?? 1}。${enemy.ultimate?.hpSource === 'boss blood table' ? '领袖生命取游戏终极血量表。' : '生命按模式倍率计算。'}</p>
      </details>`;
  }

  function syncEnemyInputs() {
    document.querySelector('#enemy-def').value = state.enemy.def;
    document.querySelector('#enemy-res').value = state.enemy.res;
    document.querySelector('#def-output').textContent =
      number.format(state.enemy.def);
    document.querySelector('#res-output').textContent =
      `${decimal.format(state.enemy.res)}%`;
  }

  function applyStrongholdEnemy() {
    const enemy = enemyMap.get(state.enemy.selectedId);
    if (!enemy) return;
    state.enemy.def = Math.max(0, enemy.defense);
    state.enemy.res = Math.max(0, enemy.resistance);
    syncEnemyInputs();
    renderStrongholdEnemyProfile();
    updateResults();
  }

  function syncStrongholdEnemyUI() {
    strongholdEnemyEnabled.checked = state.enemy.useStronghold;
    strongholdEnemyPanel.classList.toggle(
      'is-disabled',
      !state.enemy.useStronghold,
    );
    document.querySelector('#enemy-def').disabled =
      state.enemy.useStronghold;
    document.querySelector('#enemy-res').disabled =
      state.enemy.useStronghold;
    if (state.enemy.useStronghold) applyStrongholdEnemy();
  }

  function advancedInput(label, field, value, step = '1') {
    return `<label>${label}<input type="number" step="${step}" data-field="${field}" value="${escapeHtml(value)}"></label>`;
  }

  function buildSlotCard(slot, index) {
    const color = colorList[index];
    const operator = findOperator(slot);
    const skill = findSkill(slot, operator);
    return `
      <article class="slot-card" data-slot="${index}" style="--slot-color:${color.line};--slot-glow:${color.glow}">
        <div class="slot-top">
          <span class="slot-label"><i class="slot-dot"></i> 方案 ${String.fromCharCode(65 + index)}</span>
          <span class="damage-pill" data-role="damage-type">${damageTypes[slot.damageType]}</span>
        </div>
        <label class="operator-search">
          <span aria-hidden="true">⌕</span>
          <span class="visually-hidden">搜索干员</span>
          <input type="search" data-field="operatorSearch" list="operator-search-list" value="${escapeHtml(slot.operatorName)}" placeholder="搜索干员名" autocomplete="off">
        </label>
        <select class="operator-select" data-field="operatorName" aria-label="方案 ${index + 1} 干员">
          ${operatorOptions(slot.operatorName)}
        </select>
        <div class="skill-line">
          <select data-field="skillName" aria-label="技能">${skillOptions(operator, skill?.name)}</select>
          <select data-field="level" aria-label="技能等级">${levelOptions(skill, slot.level)}</select>
        </div>
        <select class="module-select" data-field="module" aria-label="模组">${moduleOptions(operator, slot.module)}</select>
        <select class="equipment-select" data-field="equipmentId" aria-label="卫戍装备">${equipmentOptions(slot.equipmentId)}</select>
        <div class="mini-row">
          <label class="trust-toggle"><input type="checkbox" data-field="trust"${slot.trust ? ' checked' : ''}> 满信赖</label>
          <label>潜能
            <select data-field="potential">
              ${[1, 2, 3, 4, 5, 6]
                .map(
                  (potential) =>
                    `<option value="${potential}"${potential === slot.potential ? ' selected' : ''}>${potential}</option>`,
                )
                .join('')}
            </select>
          </label>
        </div>
        <div class="main-result">
          <div>
            <span>60 帧终极平均 DPS</span>
            <strong data-role="cycle">—</strong>
          </div>
          <div class="result-pair">
            普攻 <b data-role="normal">—</b><br>
            技能期 <b data-role="active">—</b><br>
            击杀 <b data-role="ttk">—</b>
          </div>
        </div>
        <p class="simulation-detail" data-role="simulation-detail"></p>
        <p class="covenant-impact" data-role="covenant-impact"></p>
        <p class="covenant-impact" data-role="reference-impact"></p>
        <p class="covenant-impact" data-role="trait-impact"></p>
        <p class="description" data-role="description"></p>
        <details class="advanced">
          <summary>高级参数与手动覆盖</summary>
          <div class="advanced-grid">
            ${advancedInput('攻击加成 %', 'attackBonus', slot.attackBonus)}
            ${advancedInput('普攻倍率', 'normalMultiplier', slot.normalMultiplier, '0.01')}
            ${advancedInput('技能攻击倍率', 'activeMultiplier', slot.activeMultiplier, '0.01')}
            ${advancedInput('技能攻速', 'aspd', slot.aspd)}
            ${advancedInput('间隔变化（秒）', 'intervalDelta', slot.intervalDelta, '0.01')}
            ${advancedInput('技能持续（秒）', 'duration', slot.duration, '0.01')}
            ${advancedInput('回转（秒）', 'cooldown', slot.cooldown, '0.01')}
            ${advancedInput('普攻段数', 'normalHits', slot.normalHits)}
            ${advancedInput('技能段数', 'skillHits', slot.skillHits)}
            ${advancedInput('无视防御', 'defenseIgnore', slot.defenseIgnore)}
            ${advancedInput('无视法抗', 'resistanceIgnore', slot.resistanceIgnore)}
            <label>伤害类型
              <select data-field="damageType">
                <option value="physical"${slot.damageType === 'physical' ? ' selected' : ''}>物理</option>
                <option value="arts"${slot.damageType === 'arts' ? ' selected' : ''}>法术</option>
                <option value="true"${slot.damageType === 'true' ? ' selected' : ''}>真实 / 元素</option>
              </select>
            </label>
          </div>
        </details>
      </article>`;
  }

  function refreshSlot(index) {
    const slot = state.slots[index];
    const card = slotsElement.querySelector(`[data-slot="${index}"]`);
    const operator = findOperator(slot);
    const skill = findSkill(slot, operator);
    card.querySelector('[data-field="operatorName"]').value = operator.name;
    card.querySelector('[data-field="operatorSearch"]').value = operator.name;
    card.querySelector('[data-field="skillName"]').innerHTML = skillOptions(
      operator,
      skill?.name,
    );
    card.querySelector('[data-field="level"]').innerHTML = levelOptions(
      skill,
      slot.level,
    );
    card.querySelector('[data-field="module"]').innerHTML = moduleOptions(
      operator,
      slot.module,
    );
    for (const element of card.querySelectorAll('[data-field]')) {
      const field = element.dataset.field;
      if (!(field in slot)) continue;
      if (element.type === 'checkbox') {
        element.checked = Boolean(slot[field]);
      } else {
        element.value = slot[field];
      }
    }
    const level = findLevel(slot, skill);
    card.querySelector('[data-role="description"]').textContent =
      level?.description || operator.trait;
    card.querySelector('[data-role="damage-type"]').textContent =
      damageTypes[slot.damageType] ?? slot.damageType;
  }

  function buildSlots() {
    slotsElement.innerHTML = state.slots
      .map((slot, index) => buildSlotCard(slot, index))
      .join('');
    state.slots.forEach((_, index) => refreshSlot(index));
  }

  function calculateSlot(
    slot,
    enemy = state.enemy,
    covenantLayerCap = null,
    aspdOverride = null,
  ) {
    const operator = findOperator(slot);
    const skill = findSkill(slot, operator);
    const level = findLevel(slot, skill);
    const stats = calc.resolveOperatorStats(operator, {
      trust: slot.trust,
      potential: slot.potential,
      module: slot.module,
    });
    const covenant = combineCovenantEffects(slot, covenantLayerCap);
    const covenantEffects = covenant.effects;
    const reference = combineReferenceEffects(slot);
    const referenceEffects = reference.effects;
    const autochessTrait = combineAutoChessTrait(slot);
    const traitEffects = autochessTrait.effects;
    const chargeBased = slot.chargeBased && slot.duration <= 0;
    const useSpState =
      slot.spMode === 'natural' || slot.spMode === 'attack';
    const totalAspd =
      slot.aspd +
      covenantEffects.aspd +
      referenceEffects.aspd +
      traitEffects.aspd +
      (aspdOverride ?? 0);
    const instantWindow = Math.max(
      0.05,
      stats.attackInterval + slot.intervalDelta,
    );
    const activeWindow = slot.duration > 0 ? slot.duration : instantWindow;
    const enemyHp =
      enemy.hp ??
      (state.enemy.useStronghold
        ? enemyMap.get(state.enemy.selectedId)?.hp
        : Infinity);
    const result = calc.simulateFrameDps({
      attack: stats.attack,
      baseInterval: stats.attackInterval,
      damageType: slot.damageType,
      enemy: { ...enemy, hp: enemyHp },
      attackBonus:
        slot.attackBonus +
        covenantEffects.attackBonus +
        referenceEffects.attackBonus +
        traitEffects.attackBonus,
      normalMultiplier:
        slot.normalMultiplier * covenantEffects.damageMultiplier +
        covenantEffects.extraDamageMultiplier +
        referenceEffects.extraDamageMultiplier,
      activeMultiplier:
        slot.activeMultiplier *
          covenantEffects.damageMultiplier *
          (1 + covenantEffects.activeAttackBonus / 100) +
        covenantEffects.extraDamageMultiplier +
        referenceEffects.extraDamageMultiplier,
      normalAspd: chargeBased ? totalAspd : 0,
      aspd: chargeBased ? 0 : totalAspd,
      intervalDelta: slot.intervalDelta,
      normalHits: slot.normalHits,
      skillHits: slot.skillHits,
      duration: activeWindow,
      cooldown:
        slot.cooldown *
        covenantEffects.spCostMultiplier *
        referenceEffects.spCostMultiplier,
      defenseIgnore: slot.defenseIgnore,
      resistanceIgnore:
        slot.resistanceIgnore + covenantEffects.resistanceShred,
      defensePenetration: Math.max(
        covenantEffects.defensePenetration,
        referenceEffects.defensePenetration,
      ),
      resistancePenetration: Math.max(
        covenantEffects.resistancePenetration,
        referenceEffects.resistancePenetration,
      ),
      tick: 1 / 60,
      horizon: 120,
      sp:
        useSpState
          ? {
              mode: slot.spMode,
              cost:
                slot.spCost *
                covenantEffects.spCostMultiplier *
                referenceEffects.spCostMultiplier,
              initial: slot.spInitial + covenantEffects.initialSp,
              perSecond: 1 + traitEffects.spPerSecond,
              perAttack: 1,
              maxCharges: chargeBased ? slot.charges : 1,
              blockFrames: chargeBased ? 36 : 0,
              frameRate: 30,
            }
          : null,
    });
    return {
      slot,
      operator,
      skill,
      level,
      stats,
      activeWindow,
      result,
      covenant,
      reference,
      autochessTrait,
      totalAspd,
      chargeBased,
    };
  }

  function covenantSummary(covenant) {
    if (!state.covenants.enabled) return '未启用';
    const effects = covenant.effects ?? covenant;
    const parts = [];
    if (effects.attackBonus) {
      parts.push(`+${decimal.format(effects.attackBonus)}% 攻击`);
    }
    if (effects.activeAttackBonus) {
      parts.push(`技能期 +${decimal.format(effects.activeAttackBonus)}% 攻击`);
    }
    if (effects.aspd) {
      parts.push(`+${decimal.format(effects.aspd)} 攻速`);
    }
    if (effects.damageMultiplier !== 1) {
      parts.push(`伤害 ×${decimal.format(effects.damageMultiplier)}`);
    }
    if (effects.resistanceShred) {
      parts.push(`-${decimal.format(effects.resistanceShred)} 法抗`);
    }
    if (
      effects.defensePenetration ||
      effects.resistancePenetration
    ) {
      parts.push(
        `穿透 ${decimal.format(effects.defensePenetration * 100)}% 防 / ${decimal.format(effects.resistancePenetration * 100)}% 抗`,
      );
    }
    if (effects.extraDamageMultiplier) {
      parts.push(
        `+${number.format(effects.extraDamageMultiplier * 100)}% 附加伤害`,
      );
    }
    return parts.length
      ? `${covenant.applied.map((entry) => entry.bond.name).join('、')} · ${parts.join(' · ')}`
      : '当前方案未命中已选盟约';
  }

  function referenceSummary(reference) {
    const parts = [];
    if (reference.equipment) {
      parts.push(`装备：${reference.equipment.name}`);
    }
    if (reference.commands.length) {
      parts.push(
        `指令：${reference.commands.map((item) => item.name).join('、')}`,
      );
    }
    const effects = referenceStatChips(reference.effects);
    if (effects.length) parts.push(effects.join(' · '));
    return parts.length ? parts.join(' · ') : '未启用装备或指令修正';
  }

  function autoChessTraitSummary(info) {
    if (!info?.trait || !info.stacks) return '';
    const parts = [`${info.trait.name} ${info.totalLayers} 层`];
    if (info.effects.spPerSecond) {
      parts.push(`技力回复 +${decimal.format(info.effects.spPerSecond)}/秒`);
    }
    if (info.effects.attackBonus) {
      parts.push(`攻击 +${decimal.format(info.effects.attackBonus)}%`);
    }
    if (info.effects.aspd) {
      parts.push(`攻速 +${decimal.format(info.effects.aspd)}`);
    }
    return parts.join(' · ');
  }

  function formatKillDuration(seconds) {
    if (!Number.isFinite(seconds)) return '无法击杀';
    if (seconds < 60) return `${decimal.format(seconds)}s`;
    const minutes = Math.floor(seconds / 60);
    const rest = Math.round(seconds % 60);
    return `${minutes}m ${rest}s`;
  }

  function renderKillCalculator() {
    const enemy = enemyMap.get(state.enemy.selectedId);
    const limit = Math.max(0.1, Number(state.killLimit) || 5);
    const results =
      lastResults.length > 0
        ? lastResults
        : state.slots.map((slot) => calculateSlot(slot));
    const timeInput = document.querySelector('#kill-time-limit');
    if (document.activeElement !== timeInput) timeInput.value = limit;
    document.querySelector('#kill-target-name').textContent =
      enemy?.name ?? '未选择敌人';
    document.querySelector('#kill-target-meta').textContent = enemy
      ? `${enemy.ultimate?.modeName ?? '终极模拟'} · ${enemyCategoryLabel(enemy)} · ${enemy.enemyIndex || enemy.enemyId}`
      : '请先在上方敌人参数中选择目标';
    document.querySelector('#kill-target-stats').innerHTML = enemy
      ? `
        <span>生命<br><b>${number.format(enemy.hp)}</b></span>
        <span>攻击<br><b>${number.format(enemy.attack)}</b></span>
        <span>防御<br><b>${number.format(enemy.defense)}</b></span>
        <span>法抗<br><b>${decimal.format(enemy.resistance)}%</b></span>`
      : '<span>暂无目标数据</span>';
    const requiredDps = enemy ? enemy.hp / limit : Infinity;
    document.querySelector('#kill-required-dps').textContent =
      Number.isFinite(requiredDps)
        ? number.format(Math.ceil(requiredDps))
        : '—';
    document.querySelector('#kill-results').innerHTML = results
      .map((item, index) => {
        const dps = item.result.cycleDps;
        const estimatedKill =
          item.result.killTime ??
          (dps > 0 && enemy ? enemy.hp / dps : Infinity);
        const met = estimatedKill <= limit;
        const timeLabel =
          item.result.killTime === null
            ? `约 ${formatKillDuration(estimatedKill)}`
            : formatKillDuration(item.result.killTime);
        const gap = Math.max(0, requiredDps - dps);
        return `
          <article class="kill-result-card ${met ? 'met' : ''}" style="--slot-color:${colorList[index].line}">
            <header>
              <span>方案 ${String.fromCharCode(65 + index)}</span>
              <span>${met ? '限定时间内可击杀' : '未达到限定 DPS'}</span>
            </header>
            <h3>${escapeHtml(item.operator.name)} · ${escapeHtml(item.skill?.name ?? '仅普攻')}</h3>
            <dl>
              <dt>当前逐帧 DPS</dt><dd>${number.format(dps)}</dd>
              <dt>预计击杀时间</dt><dd>${timeLabel}</dd>
              <dt>限定时间</dt><dd>${decimal.format(limit)}s</dd>
              <dt>仍需 DPS</dt><dd>${met ? '0' : number.format(Math.ceil(gap))}</dd>
            </dl>
            <strong>${met ? '达标' : `低于最低线 ${number.format(Math.ceil(gap))} DPS`}</strong>
          </article>`;
      })
      .join('');
  }

  function updateResults() {
    const results = state.slots.map((slot) => calculateSlot(slot));
    lastResults = results;
    document.querySelector('#chart-metrics').innerHTML = results
      .map(
        (item, index) => `
          <article class="chart-metric" style="--metric-color:${colorList[index].line}">
            <span>方案 ${String.fromCharCode(65 + index)} · ${escapeHtml(item.operator.name)}</span>
            <strong>${number.format(item.result.cycleDps)}</strong>
            <small>${escapeHtml(item.skill?.name ?? '仅普攻')} · 普攻 ${item.result.normalHits} / 技能 ${item.result.skillHits} 次</small>
          </article>`,
      )
      .join('');
    results.forEach((item, index) => {
      const card = slotsElement.querySelector(`[data-slot="${index}"]`);
      card.querySelector('[data-role="cycle"]').textContent = number.format(
        item.result.cycleDps,
      );
      card.querySelector('[data-role="normal"]').textContent = number.format(
        item.result.normalDps,
      );
      card.querySelector('[data-role="active"]').textContent = number.format(
        item.result.activeDps,
      );
      card.querySelector('[data-role="ttk"]').textContent =
        item.result.killTime === null
          ? '> 120s'
          : `${decimal.format(item.result.killTime)}s`;
      card.querySelector('[data-role="simulation-detail"]').textContent =
        `1/60 秒步长 · ${number.format(item.result.ticks)} 帧 · 普攻 ${item.result.normalHits} 次 / 技能 ${item.result.skillHits} 次 · 开技能 ${item.result.skillCasts} 次${
          item.chargeBased
            ? ` · ${item.slot.charges} 充能 · 阻回 ${decimal.format((item.result.blockSeconds ?? 0) * 30)} 帧`
            : ''
        }${item.result.spPerSecond ? ` · 回技 ${decimal.format(item.result.spPerSecond)}/秒` : ''}`;
      card.querySelector('[data-role="damage-type"]').textContent =
        damageTypes[item.slot.damageType] ?? item.slot.damageType;
      card.querySelector('[data-role="covenant-impact"]').textContent =
        covenantSummary(item.covenant);
      card.querySelector('[data-role="reference-impact"]').textContent =
        referenceSummary(item.reference);
      card.querySelector('[data-role="trait-impact"]').textContent =
        autoChessTraitSummary(item.autochessTrait);
    });

    document.querySelector('#result-body').innerHTML = results
      .map((item, index) => {
        const uptime = item.result.skillUptime * 100;
        return `
          <tr style="--row-color:${colorList[index].line}">
            <td>
              <span class="table-name">
                <i></i>
                <span><b>${escapeHtml(item.operator.name)}</b><small>${escapeHtml(item.skill?.name ?? '仅普攻')} · ${escapeHtml(item.slot.level)}</small></span>
              </span>
            </td>
            <td>${number.format(item.result.effectiveAttack)}</td>
            <td>${number.format(item.result.normalDps)}</td>
            <td>${number.format(item.result.activeDps)}</td>
            <td class="cycle-cell">${number.format(item.result.cycleDps)}</td>
            <td>${item.result.killTime === null ? '&gt; 120s' : `${decimal.format(item.result.killTime)}s`}</td>
            <td>${decimal.format(item.result.normalInterval)}s</td>
            <td>${escapeHtml(covenantSummary(item.covenant))}</td>
            <td>${escapeHtml(referenceSummary(item.reference))}${
              autoChessTraitSummary(item.autochessTrait)
                ? `<br>${escapeHtml(autoChessTraitSummary(item.autochessTrait))}`
                : ''
            }</td>
            <td>${decimal.format(uptime)}%</td>
          </tr>`;
      })
      .join('');

    const best = [...results].sort(
      (a, b) => b.result.cycleDps - a.result.cycleDps,
    )[0];
    document.querySelector('#chart-summary').textContent = best
      ? `终极逐帧最高：${best.operator.name} · ${best.skill?.name ?? '普攻'}，${number.format(best.result.cycleDps)} DPS`
      : '等待计算';
    renderKillCalculator();
    drawChart();
  }

  function chartSamples() {
    if (state.axis === 'covenant') {
      const focus = focusedCovenant();
      const maxLayer = Math.max(
        1,
        focus ? state.covenants.settings[focus.bondId]?.layer ?? 0 : 1,
      );
      const step = Math.max(1, Math.ceil(maxLayer / 250));
      const samples = [];
      for (let layer = 0; layer <= maxLayer; layer += step) {
        samples.push(layer);
      }
      if (samples.at(-1) !== maxLayer) samples.push(maxLayer);
      return samples;
    }
    if (state.axis === 'aspd') {
      return Array.from({ length: 201 }, (_, index) => index);
    }
    if (state.axis === 'res') {
      return Array.from({ length: 96 }, (_, index) => index);
    }
    return Array.from({ length: 81 }, (_, index) => index * 25);
  }

  function drawChart() {
    const box = chart.getBoundingClientRect();
    if (!box.width || !box.height) return;
    const dpr = window.devicePixelRatio || 1;
    chart.width = Math.round(box.width * dpr);
    chart.height = Math.round(box.height * dpr);
    const ctx = chart.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const width = box.width;
    const height = box.height;
    const covenantAxis = state.axis === 'covenant';
    const margin = {
      left: 58,
      right: 20,
      top: covenantAxis ? 32 : 16,
      bottom: 38,
    };
    const plotWidth = width - margin.left - margin.right;
    const plotHeight = height - margin.top - margin.bottom;
    const xs = chartSamples();
    const aspdAxis = state.axis === 'aspd';
    const series = state.slots.map((slot) => ({
      name: `${findOperator(slot).name} · ${findSkill(slot)?.name ?? '普攻'}`,
      values: xs.map((value) =>
        covenantAxis
          ? calculateSlot(slot, state.enemy, value)
          : aspdAxis
            ? calculateSlot(slot, state.enemy, null, value)
          : calculateSlot(slot, { ...state.enemy, [state.axis]: value }),
      ),
      color: colorList[state.slots.indexOf(slot)].line,
    }));
    const maxValue = Math.max(
      1,
      ...series.flatMap((item) =>
        item.values.map((value) => value.result.cycleDps),
      ),
    );
    const chartMax = maxValue * 1.1;
    const xToPixel = (index) =>
      margin.left + (plotWidth * index) / (xs.length - 1);
    const yToPixel = (value) =>
      margin.top + plotHeight * (1 - value / chartMax);

    ctx.clearRect(0, 0, width, height);
    ctx.font = '11px "Segoe UI", "Microsoft YaHei UI", sans-serif';
    ctx.textBaseline = 'middle';
    for (let line = 0; line <= 5; line += 1) {
      const y = margin.top + (plotHeight * line) / 5;
      ctx.strokeStyle = line === 5 ? '#3b4960' : 'rgba(121, 143, 170, .16)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(margin.left, y);
      ctx.lineTo(width - margin.right, y);
      ctx.stroke();
      ctx.fillStyle = '#7f91a8';
      ctx.textAlign = 'right';
      ctx.fillText(
        number.format(chartMax * (1 - line / 5)),
        margin.left - 10,
        y,
      );
    }
    for (let line = 0; line <= 4; line += 1) {
      const index = Math.round(((xs.length - 1) * line) / 4);
      ctx.fillStyle = '#7f91a8';
      ctx.textAlign = 'center';
      ctx.fillText(
        covenantAxis
          ? `${xs[index]}层`
          : aspdAxis
            ? `+${xs[index]}`
          : state.axis === 'res'
            ? `${xs[index]}%`
            : number.format(xs[index]),
        xToPixel(index),
        height - 20,
      );
    }
    ctx.fillStyle = '#8799af';
    ctx.textAlign = 'left';
    ctx.fillText('DPS', 8, 14);

    for (const item of series) {
      ctx.strokeStyle = item.color;
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      item.values.forEach((value, index) => {
        const x = xToPixel(index);
        const y = yToPixel(value.result.cycleDps);
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }

    const currentIndex = covenantAxis
      ? xs.length - 1
      : aspdAxis
        ? Math.max(
            0,
            Math.min(
              xs.length - 1,
              Math.round(lastResults[0]?.totalAspd ?? 0),
            ),
          )
      : state.axis === 'res'
        ? Math.max(0, Math.min(xs.length - 1, state.enemy.res))
        : Math.round(
            ((state.enemy.def - xs[0]) / (xs.at(-1) - xs[0])) *
              (xs.length - 1),
          );
    if (currentIndex >= 0 && currentIndex < xs.length) {
      const currentX = xToPixel(currentIndex);
      ctx.strokeStyle = 'rgba(255, 177, 104, .55)';
      ctx.setLineDash([4, 5]);
      ctx.beginPath();
      ctx.moveTo(currentX, margin.top);
      ctx.lineTo(currentX, margin.top + plotHeight);
      ctx.stroke();
      ctx.setLineDash([]);
      if (covenantAxis) {
        ctx.fillStyle = '#ffb168';
        ctx.textAlign = 'right';
        ctx.fillText('终极模拟', currentX - 7, margin.top + 9);
      }
      for (const item of series) {
        ctx.fillStyle = '#0b1017';
        ctx.strokeStyle = item.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(
          currentX,
          yToPixel(item.values[currentIndex].result.cycleDps),
          3.4,
          0,
          Math.PI * 2,
        );
        ctx.fill();
        ctx.stroke();
      }
    }

    if (covenantAxis || aspdAxis) {
      const enemy = enemyMap.get(state.enemy.selectedId);
      ctx.fillStyle = '#8fa0b5';
      ctx.textAlign = 'left';
      const enemyLabel =
        width < 500
          ? `终极敌 ${enemy?.enemyIndex ?? '手动'} · ${number.format(state.enemy.def)} 防 / ${decimal.format(state.enemy.res)}% 抗`
          : `终极敌人：${enemy?.name ?? '手动参数'} · ${number.format(enemy?.hp ?? 0)} 生命 / ${number.format(state.enemy.def)} 防 / ${decimal.format(state.enemy.res)}% 抗`;
      ctx.fillText(
        enemyLabel,
        margin.left + 8,
        margin.top + 9,
      );
    }

    document.querySelector('#chart-legend').innerHTML = series
      .map(
        (item) =>
          `<span class="legend-item" style="--legend-color:${item.color}"><i></i>${escapeHtml(item.name)}${
            covenantAxis
              ? ` <b>${number.format(item.values.at(-1).result.cycleDps)}</b>`
              : ''
          }</span>`,
      )
      .join('');
    document.querySelector('#chart-title').textContent =
      covenantAxis
        ? `纯逐帧 DPS · 扫描${focusedCovenant()?.name ?? '盟约'}层数`
        : aspdAxis
          ? '纯逐帧 DPS · 随攻速加成变化'
        : state.axis === 'res'
        ? '逐帧平均 DPS · 随法术抗性变化'
        : '逐帧平均 DPS · 随防御力变化';
    chartModel = {
      xs,
      series,
      margin,
      plotWidth,
      width,
      height,
      xToPixel,
      yToPixel,
    };
  }

  function bindSlotEvents() {
    function selectOperator(index, name) {
      const slot = state.slots[index];
      slot.operatorName = name;
      const operator = findOperator(slot);
      slot.skillName = operator.skills[0]?.name ?? '';
      slot.level = 'M3';
      slot.module = '';
      slot.normalHits = 1;
      slot.skillHits = 1;
      syncAuto(slot);
      refreshSlot(index);
      renderCovenantSummary();
      renderSelectedCovenants();
      renderChartCovenantControls();
    }

    const handle = (event) => {
      const card = event.target.closest('[data-slot]');
      if (!card) return;
      const index = Number(card.dataset.slot);
      const slot = state.slots[index];
      const field = event.target.dataset.field;
      if (!field) return;

      if (field === 'operatorName') {
        selectOperator(index, event.target.value);
      } else if (field === 'operatorSearch') {
        const match = calc.matchOperatorName(
          operators.map((operator) => operator.name),
          event.target.value,
        );
        if (match) {
          selectOperator(index, match);
        } else {
          event.target.value = findOperator(slot).name;
          event.target.setAttribute('aria-invalid', 'true');
          setTimeout(
            () => event.target.removeAttribute('aria-invalid'),
            1200,
          );
        }
      } else if (field === 'skillName') {
        slot.skillName = event.target.value;
        syncAuto(slot);
        refreshSlot(index);
      } else if (field === 'level') {
        slot.level = event.target.value;
        syncAuto(slot);
        refreshSlot(index);
      } else if (field === 'module') {
        slot.module = event.target.value;
        syncAuto(slot);
        refreshSlot(index);
      } else if (field === 'equipmentId') {
        slot.equipmentId = event.target.value;
        renderEquipment();
      } else if (event.target.type === 'checkbox') {
        slot[field] = event.target.checked;
      } else if (field === 'damageType') {
        slot[field] = event.target.value;
      } else {
        slot[field] = Number(event.target.value) || 0;
      }
      updateResults();
    };
    slotsElement.addEventListener('input', (event) => {
      if (event.target.matches('input[type="number"]')) handle(event);
    });
    slotsElement.addEventListener('change', handle);
  }

  function bindCovenantEvents() {
    document
      .querySelector('#covenants-enabled')
      .addEventListener('change', (event) => {
        state.covenants.enabled = event.target.checked;
        syncCovenantPanel();
        renderCovenantSummary();
        updateResults();
      });
    document
      .querySelector('#covenant-search')
      .addEventListener('input', renderCovenantBrowser);
    document
      .querySelector('#covenant-filter')
      .addEventListener('change', renderCovenantBrowser);
    covenantListElement.addEventListener('click', (event) => {
      const button = event.target.closest('[data-covenant-pick]');
      if (!button) return;
      const bondId = button.dataset.covenantPick;
      const selected = state.covenants.selectedIds;
      const index = selected.indexOf(bondId);
      if (index >= 0) selected.splice(index, 1);
      else selected.push(bondId);
      renderCovenants();
      updateResults();
    });
    covenantSelectedList.addEventListener('click', (event) => {
      const button = event.target.closest('[data-covenant-remove]');
      if (!button) return;
      const bondId = button.dataset.covenantRemove;
      state.covenants.selectedIds = state.covenants.selectedIds.filter(
        (item) => item !== bondId,
      );
      renderCovenants();
      updateResults();
    });
    covenantSelectedList.addEventListener('input', (event) => {
      const layerId = event.target.dataset.covenantLayer;
      const membersId = event.target.dataset.covenantMembers;
      const bondId = layerId || membersId;
      if (!bondId) return;
      const settings = state.covenants.settings[bondId];
      if (layerId) settings.layer = Math.max(0, Number(event.target.value) || 0);
      else settings.members = Math.max(0, Number(event.target.value) || 0);
      event.target
        .closest('label')
        .querySelector('output').textContent = event.target.value;
      renderCovenantSummary();
      updateResults();
    });
    covenantSelectedList.addEventListener('change', (event) => {
      if (
        !event.target.dataset.covenantLayer &&
        !event.target.dataset.covenantMembers
      ) {
        return;
      }
      renderSelectedCovenants();
      renderCovenantSummary();
      renderChartCovenantControls();
      updateResults();
    });
    const chartControls = document.querySelector(
      '#chart-covenant-controls',
    );
    chartControls.addEventListener('change', (event) => {
      if (event.target.name === 'chart-covenant-axis') {
        clearTimeout(chartControlTimer);
        state.chartCovenantId = event.target.value;
        renderChartCovenantControls();
        updateResults();
      } else if (event.target.dataset.chartCovenantLayer) {
        clearTimeout(chartControlTimer);
        renderSelectedCovenants();
        renderCovenantSummary();
        updateResults();
      }
    });
    chartControls.addEventListener('input', (event) => {
      const bondId = event.target.dataset.chartCovenantLayer;
      if (!bondId) return;
      const settings = state.covenants.settings[bondId];
      if (!settings) return;
      settings.layer = Math.max(0, Number(event.target.value) || 0);
      const row = event.target.closest('.chart-covenant-row');
      row
        ?.querySelectorAll('[data-chart-covenant-layer]')
        .forEach((input) => {
          if (input !== event.target) input.value = settings.layer;
        });
      renderCovenantSummary();
      clearTimeout(chartControlTimer);
      chartControlTimer = setTimeout(updateResults, 80);
    });
  }

  function bindReferenceEvents() {
    document
      .querySelector('#equipment-enabled')
      .addEventListener('change', (event) => {
        state.equipment.enabled = event.target.checked;
        renderReferenceSummaries();
        updateResults();
      });
    document
      .querySelector('#commands-enabled')
      .addEventListener('change', (event) => {
        state.commands.enabled = event.target.checked;
        renderReferenceSummaries();
        updateResults();
      });
    document
      .querySelector('#equipment-search')
      .addEventListener('input', renderEquipment);
    document
      .querySelector('#equipment-filter')
      .addEventListener('change', renderEquipment);
    document
      .querySelector('#command-search')
      .addEventListener('input', renderCommands);
    document
      .querySelector('#command-filter')
      .addEventListener('change', renderCommands);
    equipmentList.addEventListener('click', (event) => {
      const button = event.target.closest('[data-equipment-assign]');
      if (!button) return;
      const equipmentId = button.dataset.equipmentAssign;
      const target = button.dataset.target;
      state.slots.forEach((slot, index) => {
        if (target === 'all' || String(index) === target) {
          slot.equipmentId = equipmentId;
          refreshSlot(index);
        } else if (target === 'clear' && slot.equipmentId === equipmentId) {
          slot.equipmentId = '';
          refreshSlot(index);
        }
      });
      renderEquipment();
      updateResults();
    });
    commandList.addEventListener('click', (event) => {
      const button = event.target.closest('[data-command-toggle]');
      if (!button) return;
      const commandId = button.dataset.commandToggle;
      const selected = state.commands.selectedIds;
      const index = selected.indexOf(commandId);
      if (index >= 0) selected.splice(index, 1);
      else {
        selected.push(commandId);
        state.commands.enabled = true;
        document.querySelector('#commands-enabled').checked = true;
      }
      renderCommands();
      updateResults();
    });
  }

  function bindDocumentNavigation() {
    const links = [
      ...document.querySelectorAll('#document-nav a[href^="#"]'),
    ];
    const flash = (target) => {
      target.classList.add('is-highlight');
      setTimeout(() => target.classList.remove('is-highlight'), 1600);
    };
    const navigate = (hash, smooth = true) => {
      const target = document.querySelector(hash);
      if (!target) return;
      const module = target.closest('.module');
      if (module?.classList.contains('collapsed')) {
        module.classList.remove('collapsed');
        const button = module.querySelector('[data-module-collapse]');
        if (button) button.textContent = '收起';
      }
      target.scrollIntoView({
        behavior: smooth ? 'smooth' : 'auto',
        block: 'start',
      });
      flash(target);
      try {
        history.replaceState(null, '', hash);
      } catch {
        // file:// hosts may block history replacement.
      }
    };
    for (const link of links) {
      link.addEventListener('click', (event) => {
        event.preventDefault();
        navigate(link.getAttribute('href'));
      });
    }
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (!visible) return;
        for (const link of links) {
          link.classList.toggle(
            'active',
            link.getAttribute('href') === `#${visible.target.id}`,
          );
        }
      },
      { rootMargin: '-22% 0px -62% 0px', threshold: [0, 0.2, 0.6] },
    );
    for (const link of links) {
      const target = document.querySelector(link.getAttribute('href'));
      if (target) observer.observe(target);
    }
    if (location.hash) {
      requestAnimationFrame(() => navigate(location.hash, false));
    }
  }

  function bindEnemyEvents() {
    strongholdEnemyEnabled.addEventListener('change', (event) => {
      state.enemy.useStronghold = event.target.checked;
      syncStrongholdEnemyUI();
      updateResults();
    });
    strongholdEnemySearch.addEventListener(
      'input',
      renderStrongholdEnemyOptions,
    );
    strongholdEnemySelect.addEventListener('change', (event) => {
      state.enemy.selectedId = event.target.value;
      renderStrongholdEnemyProfile();
      if (state.enemy.useStronghold) applyStrongholdEnemy();
    });
  }

  function bindKillEvents() {
    const input = document.querySelector('#kill-time-limit');
    input.addEventListener('input', (event) => {
      const value = Number(event.target.value);
      if (!(value > 0)) return;
      state.killLimit = Math.max(0.1, value);
      renderKillCalculator();
    });
    input.addEventListener('change', (event) => {
      state.killLimit = Math.min(
        3600,
        Math.max(0.1, Number(event.target.value) || 5),
      );
      renderKillCalculator();
    });
  }

  function bindModuleControls() {
    const restore = () => {
      for (const module of document.querySelectorAll('.module.maximized')) {
        module.classList.remove('maximized');
        module.querySelector('[data-module-maximize]').textContent = '放大';
      }
      document.body.classList.remove('has-maximized-module');
      requestAnimationFrame(drawChart);
    };

    for (const module of document.querySelectorAll('.module')) {
      module
        .querySelector('[data-module-collapse]')
        ?.addEventListener('click', (event) => {
          const collapsed = module.classList.toggle('collapsed');
          event.currentTarget.textContent = collapsed ? '展开' : '收起';
          requestAnimationFrame(drawChart);
        });
      module
        .querySelector('[data-module-maximize]')
        ?.addEventListener('click', (event) => {
          const wasMaximized = module.classList.contains('maximized');
          restore();
          if (!wasMaximized) {
            module.classList.add('maximized');
            event.currentTarget.textContent = '还原';
            document.body.classList.add('has-maximized-module');
            requestAnimationFrame(drawChart);
          }
        });
    }
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') restore();
    });
  }

  function updateEnemyControl(key, value) {
    state.enemy[key] = Math.max(0, Number(value) || 0);
    document.querySelector(`#enemy-${key}`).value = state.enemy[key];
    document.querySelector(`#${key}-output`).textContent =
      key === 'res' ? `${state.enemy[key]}%` : number.format(state.enemy[key]);
    updateResults();
  }

  function resetExample() {
    const defaultEnemy = enemyMap.get(defaultEnemyId);
    state.enemy = {
      def: defaultEnemy?.defense ?? 500,
      res: defaultEnemy?.resistance ?? 30,
      useStronghold: true,
      selectedId: defaultEnemyId,
    };
    state.axis = 'covenant';
    document.querySelector('#chart-axis').value = 'covenant';
    strongholdEnemySearch.value = '';
    renderStrongholdEnemyOptions();
    syncStrongholdEnemyUI();
    resetCovenants();
    state.equipment.enabled = true;
    state.commands.enabled = false;
    state.commands.selectedIds = [];
    state.killLimit = 5;
    state.slots = [
      createSlot('艾雅法拉', '点燃'),
      createSlot('艾雅法拉', '火山'),
      createSlot('逻各斯', '延异视阈'),
    ];
    buildSlots();
    renderCovenants();
    renderReferences();
    updateResults();
  }

  function exportCsv() {
    const rows = [
      [
        '干员',
        '技能',
        '等级',
        '攻击力',
        '普攻DPS',
        '技能DPS',
        '周期DPS',
        '击杀时间',
        '模拟帧数',
        '普攻命中次数',
        '技能命中次数',
        '技能开启次数',
        '普攻间隔',
        '技能持续',
        '回转',
        '敌人防御',
        '敌方法抗',
        '命中盟约',
        '装备',
        '指令',
        '装备/指令攻击加成',
        '装备/指令攻速',
        '装备/指令技力倍率',
        '盟约攻击加成',
        '盟约技能期攻击加成',
        '盟约攻速',
        '盟约伤害倍率',
        '盟约法抗削减',
        '盟约附加伤害',
        '无视防御',
        '无视法抗',
        '卫戍协议启用',
      ],
      ...state.slots.map((slot) => {
        const item = calculateSlot(slot);
        return [
          item.operator.name,
          item.skill?.name ?? '',
          slot.level,
          item.result.effectiveAttack,
          item.result.normalDps,
          item.result.activeDps,
          item.result.cycleDps,
          item.result.killTime ?? '',
          item.result.ticks,
          item.result.normalHits,
          item.result.skillHits,
          item.result.skillCasts,
          item.result.normalInterval,
          item.activeWindow,
          item.result.readyTime,
          state.enemy.def,
          state.enemy.res,
          item.covenant.applied.map((entry) => entry.bond.name).join('、'),
          item.reference.equipment?.name ?? '',
          item.reference.commands.map((command) => command.name).join('、'),
          item.reference.effects.attackBonus,
          item.reference.effects.aspd,
          item.reference.effects.spCostMultiplier,
          item.covenant.effects.attackBonus,
          item.covenant.effects.activeAttackBonus,
          item.covenant.effects.aspd,
          item.covenant.effects.damageMultiplier,
          item.covenant.effects.resistanceShred,
          item.covenant.effects.extraDamageMultiplier,
          item.covenant.effects.defensePenetration,
          item.covenant.effects.resistancePenetration,
          state.covenants.enabled ? '是' : '否',
        ];
      }),
    ];
    const text =
      '\ufeff' +
      rows
        .map((row) =>
          row
            .map((cell) => `"${String(cell).replaceAll('"', '""')}"`)
            .join(','),
        )
        .join('\n');
    const url = URL.createObjectURL(
      new Blob([text], { type: 'text/csv;charset=utf-8' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = `PRTS-DPS-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  chart.addEventListener('pointermove', (event) => {
    if (!chartModel) return;
    const rect = chart.getBoundingClientRect();
    const localX = event.clientX - rect.left;
    const ratio = Math.max(
      0,
      Math.min(
        1,
        (localX - chartModel.margin.left) / chartModel.plotWidth,
      ),
    );
    const index = Math.round(ratio * (chartModel.xs.length - 1));
    const x = chartModel.xToPixel(index);
    const value = chartModel.xs[index];
    tooltip.hidden = false;
    tooltip.style.left = `${Math.max(78, Math.min(rect.width - 78, x))}px`;
    tooltip.style.top = `${chartModel.margin.top + 14}px`;
    const xLabel =
      state.axis === 'covenant'
        ? `${focusedCovenant()?.name ?? '盟约'} ${value} 层${index === chartModel.xs.length - 1 ? ' · 当前配置' : ''}`
        : state.axis === 'aspd'
          ? `攻击速度 +${value}`
        : state.axis === 'res'
          ? `${value}% 法抗`
          : `${number.format(value)} 防御`;
    tooltip.innerHTML = `<b>${xLabel}</b><br>${chartModel.series
      .map(
        (series) =>
          `${escapeHtml(series.name)} ${number.format(series.values[index].result.cycleDps)}`,
      )
      .join('<br>')}`;
  });
  chart.addEventListener('pointerleave', () => {
    tooltip.hidden = true;
  });

  document.querySelector('#enemy-def').addEventListener('input', (event) => {
    updateEnemyControl('def', event.target.value);
  });
  document.querySelector('#enemy-res').addEventListener('input', (event) => {
    updateEnemyControl('res', event.target.value);
  });
  document.querySelector('#chart-axis').addEventListener('change', (event) => {
    state.axis = event.target.value;
    updateResults();
  });
  document.querySelector('#reset').addEventListener('click', resetExample);
  document.querySelector('#export').addEventListener('click', exportCsv);
  window.addEventListener('resize', drawChart);

  document.querySelector('#covenant-count').textContent =
    `${covenantSnapshot.covenantCount} 条盟约`;
  document.querySelector('#data-date').textContent =
    `V3_1 · b2026-11-17.2 · 终极敌人 ${enemies.length} · ${equipment.length} 装备 / ${commands.length} 指令`;
  state.slots = [
    createSlot('艾雅法拉', '点燃'),
    createSlot('艾雅法拉', '火山'),
    createSlot('逻各斯', '延异视阈'),
  ];
  operatorSearchList.innerHTML = operators
    .map(
      (operator) =>
        `<option value="${escapeHtml(operator.name)}" label="${escapeHtml(
          `${operator.name} · ${operator.profession} · ${operator.branch}`,
        )}"></option>`,
    )
    .join('');
  buildSlots();
  renderStrongholdEnemyOptions();
  syncStrongholdEnemyUI();
  renderCovenants();
  initReferenceFilters();
  renderReferences();
  bindSlotEvents();
  bindCovenantEvents();
  bindReferenceEvents();
  bindEnemyEvents();
  bindKillEvents();
  bindModuleControls();
  bindDocumentNavigation();
  updateResults();
})();
