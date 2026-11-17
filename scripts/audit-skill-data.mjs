import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import '../src/calc.js';

const projectRoot = path.resolve(import.meta.dirname, '..');

function readJson(name) {
  return JSON.parse(
    fs.readFileSync(path.join(projectRoot, 'data', name), 'utf8'),
  );
}

export function buildSkillAudit() {
  const calc = globalThis.ArkCalc;
  const operators = readJson('operators-autochess.json').operators;
  const traits = new Map(
    readJson('autochess-traits.json').traits.map((trait) => [
      trait.charId,
      trait,
    ]),
  );
  const enemy = readJson('enemies.json').enemies.find(
    (item) => item.enemyId === 'enemy_9013_acstmk',
  );
  const missingData = [];
  const invalidResults = [];
  let skillCount = 0;
  let chargeCount = 0;
  let multiHitCount = 0;

  for (const operator of operators) {
    const trait = traits.get(operator.id);
    const traitEffects = calc.evaluateAutoChessTrait(
      trait?.description ?? '',
      [100, 100],
    ).effects;
    for (const skill of operator.skills) {
      skillCount += 1;
      if (!skill.skillId) missingData.push(`${operator.name}/${skill.name}/skillId`);
      for (const [levelName, level] of Object.entries(skill.levels)) {
        if (!level.descriptionTemplate) {
          missingData.push(
            `${operator.name}/${skill.name}/${levelName}/descriptionTemplate`,
          );
        }
        if (!level.blackboard || typeof level.blackboard !== 'object') {
          missingData.push(
            `${operator.name}/${skill.name}/${levelName}/blackboard`,
          );
        }
      }

      const level =
        skill.levels.M3 ?? Object.values(skill.levels).at(-1);
      const hints = calc.estimateSkillHints(
        level.description ?? '',
        level.blackboard ?? {},
        level.maxChargeTime ?? 1,
      );
      if (hints.chargeBased) chargeCount += 1;
      if (hints.skillHits > 1) multiHitCount += 1;

      const duration = Number(level.duration) || 0;
      const chargeBased = hints.chargeBased && duration <= 0;
      const stats = calc.resolveOperatorStats(operator, {
        trust: true,
        potential: 6,
        module: '',
      });
      const spMode = skill.skillType.includes('攻击回复')
        ? 'attack'
        : skill.skillType.includes('自动回复')
          ? 'natural'
          : 'none';
      const result = calc.simulateFrameDps({
        attack: stats.attack + traitEffects.flatAttack,
        baseInterval: stats.attackInterval,
        damageType: calc.inferDamageType(
          operator.trait,
          level.description ?? '',
        ),
        enemy,
        attackBonus: traitEffects.attackBonus,
        normalAspd: chargeBased ? traitEffects.aspd : 0,
        aspd: chargeBased ? 0 : traitEffects.aspd,
        activeMultiplier: hints.attackMultiplier,
        intervalDelta: level.intervalDelta ?? hints.intervalDelta,
        duration,
        skillHits: hints.skillHits,
        tick: 1 / 60,
        horizon: 120,
        sp:
          spMode === 'none'
            ? null
            : {
                mode: spMode,
                cost: level.cost ?? 1,
                initial: level.initial ?? 0,
                perSecond: 1 + traitEffects.spPerSecond,
                perAttack: 1,
                maxCharges: chargeBased ? hints.charges : 1,
                blockFrames: chargeBased ? 36 : 0,
                frameRate: 30,
              },
      });
      for (const key of [
        'cycleDps',
        'totalDamage',
        'normalHits',
        'skillHits',
        'skillCasts',
        'ticks',
      ]) {
        if (!Number.isFinite(result[key]) || result[key] < 0) {
          invalidResults.push({
            operator: operator.name,
            skill: skill.name,
            key,
            value: result[key],
          });
        }
      }
    }
  }

  return {
    operatorCount: operators.length,
    skillCount,
    chargeCount,
    multiHitCount,
    missingData,
    invalidResults,
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(buildSkillAudit(), null, 2));
}
