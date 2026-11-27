import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const extractedRoot = 'D:/NEWgame/arknights-extracted';
const activityPath =
  `${extractedRoot}/hot-decoded/a0030fbe9e5958420310f5ecd71d66ef/activity_table071163.json`;
const manifestPath =
  `${extractedRoot}/autochess-bundle-output/bfe1215bfd84cb2fc9d29eb17a5a8018/TT_activities.ab.json`;
const levelDir =
  `${extractedRoot}/autochess-bundle-output/bfe1215bfd84cb2fc9d29eb17a5a8018`;

const readJson = (filePath) =>
  JSON.parse(fs.readFileSync(filePath, 'utf8'));
const listFiles = (root) =>
  fs.readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name));
const hashFile = (filePath) =>
  crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');

const activity = readJson(activityPath);
const season =
  activity.Activity?.Autochess?.act3autochess?.[0]?.V3_1 ?? {};
const autoData = activity.AutoChessData ?? {};
const manifest = readJson(manifestPath)['activities.ab'] ?? {};

const levelRefs = new Map();
for (const [modeId, rounds] of Object.entries(
  season.BattleDataDict ?? {},
)) {
  for (const round of rounds) {
    for (const variants of Object.values(round)) {
      for (const variant of variants) {
        const name = variant.LevelId.split('/').at(-1);
        if (!levelRefs.has(name)) levelRefs.set(name, new Set());
        levelRefs.get(name).add(modeId);
      }
    }
  }
}

const levelFiles = fs.readdirSync(levelDir)
  .filter((name) => name.startsWith('level_act3autochess'));
const referencedCurrentLevels = levelFiles.filter((name) =>
  levelRefs.has(name),
);
const presentReferenceNames = new Set(levelFiles);
const missingReferences = [...levelRefs.keys()]
  .filter((name) => !presentReferenceNames.has(name));

const baseTutorialDir =
  `${extractedRoot}/anon-text/0afe79ec422a608135172e69e648bd61`;
const hotTutorialDir =
  `${extractedRoot}/hot-anon-text/c4527ce41fe01e9a2eddcefb29f84a49`;
const tutorialNames = fs.readdirSync(hotTutorialDir)
  .filter((name) => /act1vautochess/i.test(name));
const tutorialComparisons = tutorialNames.map((name) => {
  const basePath = path.join(baseTutorialDir, name);
  const hotPath = path.join(hotTutorialDir, name);
  return {
    name,
    baseExists: fs.existsSync(basePath),
    sameContent:
      fs.existsSync(basePath) && hashFile(basePath) === hashFile(hotPath),
  };
});

const luaDir =
  `${extractedRoot}/hot-anon-text/634fa47cafb72e547a4d13e13bf44e99`;
const luaFiles = fs.readdirSync(luaDir)
  .filter((name) => /^AutoChess.*\.lua$/i.test(name));

const auxiliaryTables = [
  'display_meta_tableb1aa89.json',
  'zone_tablefb5543.json',
  'battle_misc_table.json',
  'stage_tableb3e241.json',
  'item_table1c04fa.json',
  'medal_table26d2d8.json',
  'audio_dataf6aac9.json',
  'story_tablee4e4f8.json',
  'building_data73949e.json',
  'gamedata_const61fefd.json',
  'buff_tablea22aef.json',
  'skill_tableafb859.json',
];
const auxiliaryMatches = {};
for (const tableName of auxiliaryTables) {
  const matches = listFiles(`${extractedRoot}/hot-decoded`)
    .filter((filePath) => path.basename(filePath) === tableName);
  if (!matches.length && tableName === 'buff_tablea22aef.json') {
    matches.push(
      `${extractedRoot}/decoded/b71788197ff5e1a92460da4ccad811aa/${tableName}`,
    );
  }
  for (const filePath of matches) {
    const data = readJson(filePath);
    let count = 0;
    const samplePaths = [];
    const walk = (value, currentPath = []) => {
      if (!value || typeof value !== 'object') return;
      for (const [key, child] of Object.entries(value)) {
        if (typeof child === 'string' && /autochess/i.test(child)) {
          count += 1;
          if (samplePaths.length < 8) {
            samplePaths.push(currentPath.concat(key).join('.'));
          }
        } else if (child && typeof child === 'object') {
          walk(child, currentPath.concat(key));
        }
      }
    };
    walk(data);
    auxiliaryMatches[tableName] = { count, samplePaths };
  }
}

const currentLevels = Object.entries(manifest)
  .filter(([, asset]) =>
    /autochess/i.test(String(asset?.m_Name ?? '')),
  )
  .map(([pathId, asset]) => ({
    pathId,
    name: asset.m_Name,
  }));

const installedBundleRoot =
  'D:/Hypergryph Launcher/games/Arknights/Arknights_Data/PersistentData/Bundles';
const downloadRoot =
  'D:/Hypergryph Launcher/games/Arknights/Arknights_Data/PersistentData/HGDownload';
const classifyInstalledBundle = (relativePath) => {
  if (relativePath.includes('battle/prefabs/levelprefabs')) {
    return 'battle-level-prefabs';
  }
  if (relativePath.includes('scenes/activities/act3autochess')) {
    return 'level-scenes';
  }
  if (relativePath.includes('arts/ui/stage/mappreviews')) {
    return 'map-previews';
  }
  if (relativePath.includes('ui/autochess')) {
    return 'autochess-ui';
  }
  if (relativePath.includes('audio')) {
    return 'audio';
  }
  if (relativePath.includes('building')) {
    return 'furniture';
  }
  if (relativePath.includes('spritepack')) {
    return 'zone-home-sprites';
  }
  if (relativePath.includes('activity/')) {
    return 'activity-textassets';
  }
  return 'other';
};
const installedAutochessFiles = fs.existsSync(installedBundleRoot)
  ? listFiles(installedBundleRoot)
      .filter((filePath) => /autochess/i.test(filePath))
  : [];
const installedBundleGroups = {};
for (const filePath of installedAutochessFiles) {
  const relativePath = path
    .relative(installedBundleRoot, filePath)
    .replaceAll('\\', '/');
  const category = classifyInstalledBundle(relativePath);
  const group = (installedBundleGroups[category] ??= {
    count: 0,
    bytes: 0,
  });
  group.count += 1;
  group.bytes += fs.statSync(filePath).size;
}
const downloadAutochessFiles = fs.existsSync(downloadRoot)
  ? listFiles(downloadRoot)
      .filter((filePath) => /autochess/i.test(path.basename(filePath)))
  : [];

const report = {
  activity: {
    modes: Object.keys(season.ModeDataDict ?? {}).length,
    currentBattleReferences: levelRefs.size,
    referencedAct3Levels: referencedCurrentLevels.length,
    missingBattleLevelReferences: missingReferences,
  },
  assetBundle: {
    manifestAssetCount: Object.keys(manifest).length,
    currentAutochessNamedAssets: currentLevels.length,
    currentAutochessLevelAssets: levelFiles.length,
    otherManifestAssets: Object.keys(manifest).length - currentLevels.length,
  },
  installedPersistentData: {
    autochessFileCount: installedAutochessFiles.length,
    groups: installedBundleGroups,
    hotDownloadFileCount: downloadAutochessFiles.length,
    hotDownloadBytes: downloadAutochessFiles.reduce(
      (sum, filePath) => sum + fs.statSync(filePath).size,
      0,
    ),
  },
  tutorials: {
    count: tutorialNames.length,
    baseAndHotIdentical: tutorialComparisons.every(
      (entry) => entry.baseExists && entry.sameContent,
    ),
    sharedPoolMentioned: tutorialNames.some((name) =>
      /共享.*牌库|牌库.*共享/.test(
        fs.readFileSync(path.join(hotTutorialDir, name), 'utf8'),
      ),
    ),
  },
  hotfixLua: {
    count: luaFiles.length,
    files: luaFiles,
  },
  applicationTables: {
    gameTips: autoData.GameTipsList?.length ?? 0,
    effectTypes: Object.keys(autoData.EffectTypeDataDict ?? {}).length,
    skillTriggerRules: autoData.SkillTriggerDataList?.length ?? 0,
    turnInfoModes: Object.keys(autoData.TurnInfoDataDict ?? {}).length,
    shopStateTokens: Object.keys(autoData.ShopStateTokenDict ?? {}).length,
  },
  auxiliaryMatches,
  classifications: {
    deterministicCalculation:
      'activity table, enemy database, current-season FlatBuffer levels, Garrison/effect tables',
    presentationOnly:
      'display_meta, audio, story, medals, item/emote presentation, furniture',
    boardOrUiOnly:
      'battle_misc map areas/cameras, zone metadata, stage preview metadata',
    markerBuffsOnly:
      'five autochess marker buffs in buff_table; no damage formula data',
    legacyOrObsolete:
      'act1/act1v/act2 stage entries and tutorial assets predate current V3_1',
  },
};

console.log(JSON.stringify(report, null, 2));
