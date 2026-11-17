import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import '../src/calc.js';

const projectRoot = path.resolve(import.meta.dirname, '..');

function readData(name) {
  return JSON.parse(
    fs.readFileSync(path.join(projectRoot, 'data', name), 'utf8'),
  );
}

function countBy(values) {
  return values.reduce((counts, value) => {
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}

export function buildRosterAudit() {
  const operatorsSnapshot = readData('operators-autochess.json');
  const traitsSnapshot = readData('autochess-traits.json');
  const modulesSnapshot = readData('autochess-modules.json');
  const operators = operatorsSnapshot.operators;
  const operatorIds = new Set(operators.map((operator) => operator.id));
  const relevantTraitTerms = [
    '技力自然回复速度',
    '攻击速度',
    '攻击力',
  ];
  const unsupportedRelevantTraits = [];
  const parsedTraitEffects = traitsSnapshot.traits.map((trait) => {
    const evaluation = globalThis.ArkCalc.evaluateAutoChessTrait(
      trait.description,
      [100, 100],
    );
    const relevant = relevantTraitTerms.some((term) =>
      trait.description.includes(term),
    );
    const effects = evaluation.effects;
    const parsed =
      effects.spPerSecond ||
      effects.aspd ||
      effects.attackBonus ||
      effects.flatAttack;
    if (relevant && !parsed) unsupportedRelevantTraits.push(trait);
    return { trait, evaluation };
  });

  const missingOperators = operators.filter(
    (operator) =>
      !operator.skills?.length ||
      !Number.isFinite(operator.stats?.e2?.attack) ||
      operator.stats.e2.attack <= 0,
  );
  const chargeSkills = operators.flatMap((operator) =>
    operator.skills.flatMap((skill) => {
      const level =
        skill.levels.M3 ?? Object.values(skill.levels).at(-1);
      if (!level?.description?.includes('可充能')) return [];
      return [
        {
          operatorId: operator.id,
          operatorName: operator.name,
          profession: operator.profession,
          skillName: skill.name,
          skillType: skill.skillType,
          cost: level.cost,
          maxChargeTime: level.maxChargeTime,
        },
      ];
    }),
  );
  const invalidChargeSkills = chargeSkills.filter(
    (skill) =>
      !Number.isFinite(skill.cost) ||
      skill.cost <= 0 ||
      !Number.isFinite(skill.maxChargeTime) ||
      skill.maxChargeTime < 1,
  );

  const talentMechanics = countBy(
    operators.flatMap((operator) =>
      (operator.talents ?? []).flatMap(
        (talent) => talent.mechanics ?? [],
      ),
    ),
  );
  const conditionalTalents = operators.reduce(
    (count, operator) =>
      count +
      (operator.talents ?? []).filter(
        (talent) => talent.conditional,
      ).length,
    0,
  );
  const supportedTalents = operators.reduce(
    (count, operator) =>
      count +
      (operator.talents ?? []).filter(
        (talent) =>
          talent.supported &&
          Object.keys(talent.effects ?? {}).length > 0,
      ).length,
    0,
  );

  const moduleEntries = Object.entries(
    modulesSnapshot.modulesByCharId ?? {},
  );
  const modules = moduleEntries.flatMap(([charId, entries]) =>
    entries.map((module) => ({ ...module, charId })),
  );
  const unknownModuleOwners = moduleEntries
    .map(([charId]) => charId)
    .filter((charId) => !operatorIds.has(charId));
  const invalidModuleLevels = modules.filter(
    (module) =>
      !Array.isArray(module.levels) ||
      module.levels.length < 1 ||
      module.levels.some(
        (level) =>
          !Number.isFinite(level.attack) ||
          !Number.isFinite(level.hp),
      ),
  );

  const skillRisks = operators.flatMap((operator) =>
    operator.skills.flatMap((skill) => {
      const level =
        skill.levels.M3 ?? Object.values(skill.levels).at(-1);
      const text = level?.description ?? '';
      const mechanics = [
        ['概率', 'probability'],
        ['召唤', 'summon'],
        ['阻挡', 'block'],
        ['受击', 'on-hit'],
        ['随机', 'random'],
        ['持续', 'duration'],
      ]
        .filter(([term]) => text.includes(term))
        .map(([, mechanic]) => mechanic);
      return mechanics.map((mechanic) => ({
        operatorId: operator.id,
        skillName: skill.name,
        mechanic,
      }));
    }),
  );

  const namedSamples = Object.fromEntries(
    [
      'char_180_amgoat',
      'char_4133_logos',
      'char_4193_lemuen',
      'char_1051_headb2',
      'char_416_zumama',
      'char_618_acrbot',
    ].map((id) => {
      const operator = operators.find((entry) => entry.id === id);
      return [
        id,
        operator
          ? {
              name: operator.name,
              attack: operator.stats.e2.attack,
              skills: operator.skills.map((skill) => skill.name),
              talentCount: operator.talents?.length ?? 0,
              supportedTalents: (operator.talents ?? []).filter(
                (talent) => talent.supported,
              ).length,
              conditionalTalents: (operator.talents ?? []).filter(
                (talent) => talent.conditional,
              ).length,
            }
          : null,
      ];
    }),
  );

  return {
    operatorCount: operators.length,
    traitCount: traitsSnapshot.traitCount,
    missingOperators,
    parsedTraitEffects,
    unsupportedRelevantTraits,
    chargeSkills,
    invalidChargeSkills,
    talentMechanics,
    conditionalTalents,
    supportedTalents,
    moduleCount: modules.length,
    moduleCharacterCount: moduleEntries.length,
    unknownModuleOwners,
    invalidModuleLevels,
    skillRiskCounts: countBy(
      skillRisks.map((risk) => risk.mechanic),
    ),
    namedSamples,
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const audit = buildRosterAudit();
  console.log(
    JSON.stringify(
      {
        operatorCount: audit.operatorCount,
        traitCount: audit.traitCount,
        missingOperators: audit.missingOperators.map(
          (operator) => operator.name,
        ),
        unsupportedRelevantTraits:
          audit.unsupportedRelevantTraits.map((trait) => trait.name),
        chargeSkillCount: audit.chargeSkills.length,
        chargeProfessions: countBy(
          audit.chargeSkills.map((skill) => skill.profession),
        ),
        invalidChargeSkills: audit.invalidChargeSkills,
        supportedTalents: audit.supportedTalents,
        conditionalTalents: audit.conditionalTalents,
        talentMechanics: audit.talentMechanics,
        moduleCount: audit.moduleCount,
        moduleCharacterCount: audit.moduleCharacterCount,
        invalidModuleLevels: audit.invalidModuleLevels.length,
        skillRiskCounts: audit.skillRiskCounts,
        namedSamples: audit.namedSamples,
      },
      null,
      2,
    ),
  );
}
