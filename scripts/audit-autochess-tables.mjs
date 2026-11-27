import fs from 'node:fs';
import path from 'node:path';

const activityPath =
  process.argv[2] ??
  'D:/NEWgame/arknights-extracted/hot-decoded/a0030fbe9e5958420310f5ecd71d66ef/activity_table071163.json';
const characterPath =
  process.argv[3] ??
  'D:/NEWgame/arknights-extracted/hot-decoded/74976659a5aaaf0dc4df9ae2506c2a59/character_tablec913b6.json';
const enemyPath =
  process.argv[4] ??
  'D:/NEWgame/arknights-extracted/hot-decoded/605f70adca6554eb8bcb869ccd1418ea/enemy_database0e81c0.json';

const readJson = (filePath) =>
  JSON.parse(fs.readFileSync(filePath, 'utf8'));
const activity = readJson(activityPath);
const characters = readJson(characterPath).Characters ?? {};
const enemies = readJson(enemyPath).Enemies ?? {};
const season =
  activity.Activity?.Autochess?.act3autochess?.[0]?.V3_1 ?? {};
const autoData = activity.AutoChessData ?? {};

const names = {
  modes: Object.keys(season.ModeDataDict ?? {}),
  battles: Object.keys(season.BattleDataDict ?? {}),
  bonds: Object.keys(season.BondInfoDict ?? {}),
  chess: Object.keys(season.CharChessDataDict ?? {}),
  shops: Object.keys(season.CharShopChessDatas ?? {}),
  garrisons: Object.keys(season.GarrisonDataDict ?? {}),
  effects: Object.keys(season.EffectInfoDataDict ?? {}),
  traps: Object.keys(season.TrapChessDataDict ?? {}),
  skills: Object.keys(season.SkillInfoDataDict ?? {}),
  specialEnemies: Object.keys(season.SpecialEnemyInfoDict ?? {}),
};

const issues = [];
const addIssue = (kind, id, detail) =>
  issues.push({ kind, id, detail });

for (const modeId of names.modes) {
  const mode = season.ModeDataDict[modeId];
  for (const bondId of mode.ActiveBondIdList ?? []) {
    if (
      !names.bonds.includes(bondId) &&
      modeId !== 'mode_training_2'
    ) {
      addIssue('mode-active-bond-missing', modeId, bondId);
    }
  }
  for (const bondId of mode.InactiveBondIdList ?? []) {
    if (!names.bonds.includes(bondId)) {
      addIssue('mode-inactive-bond-missing', modeId, bondId);
    }
  }
  for (const enemyId of mode.InactiveEnemyKey ?? []) {
    if (!enemies[enemyId]) {
      addIssue('mode-inactive-enemy-missing', modeId, enemyId);
    }
  }
  if (!season.BattleDataDict?.[modeId]) {
    addIssue('mode-battle-data-missing', modeId, 'BattleDataDict');
  }
}

for (const [shopId, shop] of Object.entries(
  season.CharShopChessDatas ?? {},
)) {
  if (
    !characters[shop.CharId] &&
    !(shop.ChessId?.includes('_diy') && !shop.CharId)
  ) {
    addIssue('shop-character-missing', shopId, shop.CharId);
  }
  if (!season.CharChessDataDict?.[shop.ChessId]) {
    addIssue('shop-chess-missing', shopId, shop.ChessId);
  }
  if (shop.GoldenChessId && !season.CharChessDataDict[shop.GoldenChessId]) {
    addIssue('shop-golden-chess-missing', shopId, shop.GoldenChessId);
  }
}

for (const [chessId, chess] of Object.entries(
  season.CharChessDataDict ?? {},
)) {
  for (const garrisonId of chess.GarrisonIds ?? []) {
    if (!season.GarrisonDataDict?.[garrisonId]) {
      addIssue('chess-garrison-missing', chessId, garrisonId);
    }
  }
  for (const bondId of chess.BondIds ?? []) {
    if (!names.bonds.includes(bondId)) {
      addIssue('chess-bond-missing', chessId, bondId);
    }
  }
}

for (const [trapId, trap] of Object.entries(
  season.TrapChessDataDict ?? {},
)) {
  if (!characters[trap.CharId]) {
    addIssue('trap-character-missing', trapId, trap.CharId);
  }
  if (trap.EffectId && !season.EffectInfoDataDict?.[trap.EffectId]) {
    addIssue('trap-effect-missing', trapId, trap.EffectId);
  }
  if (trap.GiveBondId && !names.bonds.includes(trap.GiveBondId)) {
    addIssue('trap-bond-missing', trapId, trap.GiveBondId);
  }
}

for (const [effectId, skill] of Object.entries(
  season.SkillInfoDataDict ?? {},
)) {
  if (!season.EffectInfoDataDict?.[effectId]) {
    addIssue('skill-effect-missing', effectId, effectId);
  }
  if (skill.BandId && !season.BandDataListDict?.[skill.BandId]) {
    addIssue('skill-band-missing', effectId, skill.BandId);
  }
}

for (const [specialId, info] of Object.entries(
  season.SpecialEnemyInfoDict ?? {},
)) {
  if (!enemies[specialId]) {
    addIssue('special-enemy-missing', specialId, specialId);
  }
  if (!season.SpecialEnemyRandomTypeDict?.[info.Type]) {
    addIssue('special-enemy-type-missing', specialId, info.Type);
  }
  for (const enemyId of [
    ...(info.AttachedNormalEnemyKeys ?? []),
    ...(info.AttachedEliteEnemyKeys ?? []),
  ]) {
    if (!enemies[enemyId]) {
      addIssue('special-attached-enemy-missing', specialId, enemyId);
    }
  }
}

for (const templateKey of Object.entries(autoData.ConstData ?? {})
  .filter(([key]) => key.startsWith('TemplateEnemy'))
  .map(([, value]) => value)) {
  if (!enemies[templateKey]) {
    addIssue('template-enemy-missing', 'ConstData', templateKey);
  }
}

const garrisonTypes = {};
for (const garrison of Object.values(season.GarrisonDataDict ?? {})) {
  const key = `${garrison.EventType ?? 'NONE'}|${garrison.EffectType ?? 'NONE'}`;
  garrisonTypes[key] = (garrisonTypes[key] ?? 0) + 1;
}

const report = {
  source: {
    activity: path.resolve(activityPath),
    characterTable: path.resolve(characterPath),
    enemyDatabase: path.resolve(enemyPath),
  },
  counts: {
    modes: names.modes.length,
    battleModes: names.battles.length,
    bonds: names.bonds.length,
    chessEntries: names.chess.length,
    shopEntries: names.shops.length,
    garrisonEffects: names.garrisons.length,
    effects: names.effects.length,
    traps: names.traps.length,
    skillEffects: names.skills.length,
    specialEnemies: names.specialEnemies.length,
  },
  garrisonTypes,
  expectedExceptions: [
    'mode_training_2 references removed training bond lateranoShip',
    '12 tier-5/tier-6 DIY shop entries have no CharId until runtime selection',
  ],
  issues,
};

console.log(JSON.stringify(report, null, 2));
if (issues.length) process.exitCode = 1;
