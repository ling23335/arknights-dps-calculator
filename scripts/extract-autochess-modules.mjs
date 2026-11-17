import fs from 'node:fs';
import path from 'node:path';
import { stripGameMarkup } from './reference-data.mjs';

const projectRoot = path.resolve(import.meta.dirname, '..');
const operators = JSON.parse(
  fs.readFileSync(
    path.join(projectRoot, 'data/operators-autochess.json'),
    'utf8',
  ),
);
const decodedRoot =
  process.env.ARK_HOT_DECODED ||
  'D:/NEWgame/arknights-extracted/hot-decoded';
const uniequipPath = findFile(decodedRoot, 'uniequip_table8b1bb5.json');
const battleEquipPath = findFile(
  decodedRoot,
  'battle_equip_table91e6b6.json',
);
if (!uniequipPath || !battleEquipPath) {
  throw new Error('未找到模组数据表');
}
const uniequip = JSON.parse(fs.readFileSync(uniequipPath, 'utf8'));
const battleEquip = JSON.parse(
  fs.readFileSync(battleEquipPath, 'utf8'),
).Equips;

function findFile(root, fileName) {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (entry.isFile() && entry.name === fileName) return fullPath;
    if (entry.isDirectory()) {
      const found = findFile(fullPath, fileName);
      if (found) return found;
    }
  }
  return null;
}

function formatValue(value, format = '') {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return String(value ?? '');
  if (format.includes('%')) return `${Math.round(numeric * 100)}%`;
  const decimals = format.split('.')[1]?.length ?? 0;
  return numeric.toFixed(decimals).replace(/\.0+$/, '');
}

function renderTemplate(template, blackboard = {}) {
  return String(template ?? '').replace(
    /\{([^}:]+)(?::([^}]+))?\}/g,
    (whole, expression, format) => {
      const key = expression.trim();
      if (!(key in blackboard)) return whole;
      return formatValue(blackboard[key], format);
    },
  );
}

function candidates(parts, bundleKey) {
  return parts.flatMap(
    (part) => part[bundleKey]?.Candidates ?? [],
  );
}

function extractLevel(phase, parts) {
  const attribute = phase.AttributeBlackboard ?? {};
  const overrides = candidates(parts, 'OverrideTraitDataBundle');
  const talentOverrides = candidates(
    parts,
    'AddOrOverrideTalentDataBundle',
  );
  const traitDescriptions = overrides.map((candidate) =>
    stripGameMarkup(
      renderTemplate(
        candidate.AdditionalDescription,
        candidate.Blackboard ?? {},
      ),
    ),
  );
  const talentDescriptions = talentOverrides.map((candidate) =>
    stripGameMarkup(
      renderTemplate(
        candidate.UpgradeDescription,
        candidate.Blackboard ?? {},
      ),
    ),
  );
  const blackboard = {
    ...attribute,
    overrides: overrides.map((candidate) => candidate.Blackboard ?? {}),
    talents: talentOverrides.map((candidate) => candidate.Blackboard ?? {}),
  };
  return {
    level: phase.EquipLevel,
    attack: attribute.atk ?? 0,
    hp: attribute.max_hp ?? 0,
    defense: attribute.def ?? 0,
    resistance: attribute.magic_resistance ?? 0,
    aspd: attribute.attack_speed ?? 0,
    blackboard,
    trait: traitDescriptions.filter(Boolean).join('\n'),
    upgradedTalent: talentDescriptions.filter(Boolean).join('\n'),
    traits: overrides.map((candidate) => ({
      description: stripGameMarkup(
        renderTemplate(
          candidate.AdditionalDescription,
          candidate.Blackboard ?? {},
        ),
      ),
      blackboard: candidate.Blackboard ?? {},
    })),
    talents: talentOverrides.map((candidate) => ({
      name: candidate.Name ?? '',
      description: stripGameMarkup(
        renderTemplate(
          candidate.UpgradeDescription,
          candidate.Blackboard ?? {},
        ),
      ),
      potentialRank: candidate.RequiredPotentialRank ?? 0,
      blackboard: candidate.Blackboard ?? {},
    })),
  };
}

const modulesByCharId = {};
for (const operator of operators.operators) {
  const rows = [];
  for (const equipId of uniequip.CharEquip[operator.id] ?? []) {
    const metadata = uniequip.EquipDict[equipId];
    if (!metadata || metadata.Type <= 0) continue;
    const battle = battleEquip[equipId];
    if (!battle) continue;
    const levels = battle.Phases.map((phase) =>
      extractLevel(
        phase,
        phase.Parts ?? [],
      ),
    );
    const top = levels.at(-1);
    rows.push({
      id: equipId,
      charId: operator.id,
      name: metadata.UniEquipName,
      type: metadata.Type,
      typeName: [metadata.TypeName1, metadata.TypeName2]
        .filter(Boolean)
        .join('-'),
      order: metadata.CharEquipOrder ?? 0,
      attack: top.attack,
      hp: top.hp,
      defense: top.defense,
      resistance: top.resistance,
      aspd: top.aspd,
      blackboard: top.blackboard,
      trait: top.trait,
      upgradedTalent: top.upgradedTalent,
      traits: top.traits,
      talents: top.talents,
      levels,
    });
  }
  if (rows.length) {
    modulesByCharId[operator.id] = rows.sort(
      (a, b) => a.order - b.order,
    );
  }
}

const modules = Object.values(modulesByCharId).flat();
if (modules.length !== 205) {
  throw new Error(`模组数量异常：${modules.length}`);
}
const knownIds = new Set(operators.operators.map((operator) => operator.id));
if (
  Object.keys(modulesByCharId).some((charId) => !knownIds.has(charId))
) {
  throw new Error('模组关联了非卫戍干员');
}

const result = {
  source: {
    dataSource: 'local-game-tables',
    uniequipTable: uniequipPath,
    battleEquipTable: battleEquipPath,
    hotUpdateVersion: operators.source.hotUpdateVersion,
  },
  moduleCount: modules.length,
  characterCount: Object.keys(modulesByCharId).length,
  modulesByCharId,
};
const json = JSON.stringify(result);
fs.writeFileSync(
  path.join(projectRoot, 'data/autochess-modules.json'),
  json,
);
fs.writeFileSync(
  path.join(projectRoot, 'data/autochess-modules.js'),
  `window.ARK_AUTOCHESS_MODULES_SNAPSHOT=${json};\n`,
);
console.log(
  `Wrote ${modules.length} modules for ${result.characterCount} operators`,
);
