import fs from 'node:fs';
import path from 'node:path';

const projectRoot = path.resolve(import.meta.dirname, '..');
const traits = JSON.parse(
  fs.readFileSync(
    path.join(projectRoot, 'data/autochess-traits.json'),
    'utf8',
  ),
);
const covenants = JSON.parse(
  fs.readFileSync(path.join(projectRoot, 'data/covenants.json'), 'utf8'),
);
const fullOperators = JSON.parse(
  fs.readFileSync(path.join(projectRoot, 'data/operators.json'), 'utf8'),
);
const characterPath = covenants.source.characterTable;
const characters = JSON.parse(
  fs.readFileSync(characterPath, 'utf8'),
).Characters;
const skillPath = findFile(
  process.env.ARK_HOT_DECODED ||
    'D:/NEWgame/arknights-extracted/hot-decoded',
  'skill_tableafb859.json',
);
if (!skillPath) throw new Error('未找到 skill_table JSON');
const skills = JSON.parse(fs.readFileSync(skillPath, 'utf8')).Skills;

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

function stripMarkup(value) {
  return String(value ?? '')
    .replace(/<\/>|<@[^>]+>|<\$[^>]+>/g, '')
    .replaceAll('\\n', '\n');
}

function formatValue(value, format = '') {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return String(value ?? '');
  if (format.includes('%')) return `${Math.round(numeric * 100)}%`;
  const decimal = format.split('.')[1]?.length ?? 0;
  return numeric.toFixed(decimal).replace(/\.0+$/, '');
}

function renderTemplate(template, blackboard = {}) {
  return String(template ?? '').replace(
    /\{([^}:]+)(?::([^}]+))?\}/g,
    (whole, expression, format) => {
      const trimmed = expression.trim();
      const negative = trimmed.startsWith('-');
      const key = negative ? trimmed.slice(1) : trimmed;
      if (!(key in blackboard)) return whole;
      return formatValue(negative ? -blackboard[key] : blackboard[key], format);
    },
  );
}

const levelNames = ['1', '2', '3', '4', '5', '6', '7', 'M1', 'M2', 'M3'];
const professionNames = {
  1: '近卫',
  2: '狙击',
  4: '重装',
  8: '医疗',
  16: '辅助',
  32: '术师',
  64: '特种',
  512: '先锋',
};
const fullById = new Map(
  fullOperators.operators.map((operator) => [operator.id, operator]),
);

function extractLevel(level) {
  const blackboard = level.Blackboard ?? {};
  return {
    description: stripMarkup(
      renderTemplate(level.Description, blackboard),
    ),
    initial: level.SpData?.InitSp ?? 0,
    cost: level.SpData?.SpCost ?? 0,
    duration:
      level.Duration > 0 ? level.Duration : null,
    blackboard,
    intervalDelta: Number(blackboard.base_attack_time ?? 0),
    maxChargeTime: level.SpData?.MaxChargeTime ?? 1,
  };
}

const operators = traits.traits
  .map((trait) => {
    const character = characters[trait.charId];
    if (!character?.Phases?.length) return null;
    const previous = fullById.get(trait.charId);
    const phaseStats = character.Phases.map((phase) => {
      const data = phase.AttributesKeyFrames.at(-1)?.Data ?? {};
      return {
        hp: data.MaxHp ?? 0,
        attack: data.Atk ?? 0,
        defense: data.Def ?? 0,
        resistance: data.MagicResistance ?? 0,
      };
    });
    const maxPhase =
      character.Phases.at(-1)?.AttributesKeyFrames.at(-1)?.Data ?? {};
    const favor =
      character.FavorKeyFrames?.at(-1)?.Data ?? {};
    const potentialMods = (character.PotentialRanks ?? [])
      .flatMap((rank, index) =>
        (rank.Buff?.Attributes?.AttributeModifiers ?? []).map((modifier) => ({
          level: index + 2,
          type:
            modifier.AttributeType === 1
              ? 'atk'
              : modifier.AttributeType === 4
                ? 'cost'
                : null,
          amount: modifier.Value,
        })),
      )
      .filter((modifier) => modifier.type);
    const extractedSkills = character.Skills.map((skillRef) => {
      const skill = skills[skillRef.SkillId];
      if (!skill) return null;
      const first = skill.Levels[0];
      const levels = Object.fromEntries(
        skill.Levels.slice(0, levelNames.length).map((level, index) => [
          levelNames[index],
          extractLevel(level),
        ]),
      );
      const spType = first.SpData?.SpType;
      const trigger = first.SkillType;
      return {
        name: first.Name,
        skillType:
          spType === 1
            ? '自动回复'
            : spType === 2
              ? '攻击回复'
              : '被动',
        triggerType:
          trigger === 1
            ? '手动触发'
            : trigger === 2
              ? '自动触发'
              : '被动',
        range: first.RangeId ?? '',
        levels,
      };
    }).filter(Boolean);
    return {
      id: trait.charId,
      page: character.Name,
      name: character.Name,
      nameEn: previous?.nameEn ?? '',
      rarity: (character.Rarity ?? previous?.rarity ?? 1) + 1,
      profession:
        professionNames[character.Profession] ??
        previous?.profession ??
        '特殊',
      branch: previous?.branch ?? character.SubProfessionId ?? '',
      position: previous?.position ?? character.Position ?? '',
      tags: character.TagList ?? previous?.tags ?? [],
      trait: previous?.trait ?? '',
      stats: {
        attackInterval: maxPhase.BaseAttackTime ?? 1,
        redeploy: maxPhase.RespawnTime ?? 0,
        cost: maxPhase.Cost ?? 0,
        block: maxPhase.BlockCnt ?? 0,
        e0: phaseStats[0],
        e1: phaseStats[1],
        e2: phaseStats[2],
        maxElite: Math.max(0, phaseStats.length - 1),
        trust: {
          hp: favor.MaxHp ?? 0,
          attack: favor.Atk ?? 0,
          defense: favor.Def ?? 0,
          resistance: favor.MagicResistance ?? 0,
        },
      },
      potential: { mods: potentialMods },
      skills: extractedSkills,
      talents: (character.Talents ?? []).flatMap((talent) =>
        (talent.Candidates ?? []).map((candidate) => ({
          group: talent.TalentIndex ?? '',
          name: candidate.Name,
          condition: candidate.UnlockCondition
            ? `精英${candidate.UnlockCondition.Phase + 1}`
            : '',
          effect: stripMarkup(candidate.Description),
        })),
      ),
      modules: [],
    };
  })
  .filter(Boolean)
  .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));

if (operators.length !== traits.traitCount) {
  throw new Error(
    `干员数量异常：${operators.length} / ${traits.traitCount}`,
  );
}
if (!operators.some((operator) => operator.id === 'char_618_acrbot')) {
  throw new Error('森蚺指令特殊干员“暴躁铁皮”缺失');
}
if (
  operators.some(
    (operator) =>
      !operator.skills.length ||
      !operator.stats?.e2?.attack,
  )
)
{
  throw new Error('存在缺少技能或精英二攻击力的卫戍干员');
}

const result = {
  source: {
    dataSource: 'local-game-tables',
    characterTable: characterPath,
    skillTable: skillPath,
    hotUpdateVersion: covenants.source.hotUpdateVersion,
  },
  operatorCount: operators.length,
  operators,
};
const json = JSON.stringify(result);
fs.writeFileSync(
  path.join(projectRoot, 'data/operators-autochess.json'),
  json,
);
fs.writeFileSync(
  path.join(projectRoot, 'data/operators-autochess.js'),
  `window.ARK_OPERATOR_SNAPSHOT=${json};\n`,
);
console.log(`Wrote ${operators.length} local autochess operators`);
