import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const richTextTag = /<\/>|<@[^>]+>|<\$[^>]+>/g;

export function stripGameMarkup(value) {
  return String(value ?? '')
    .replaceAll('\\n', '\n')
    .replace(richTextTag, '')
    .replaceAll('{@tag}', '')
    .trim();
}

export function extractAutomaticStats(buffGroups = []) {
  const stats = {};
  for (const group of buffGroups) {
    const board = group?.Blackboard ?? {};
    if (Number.isFinite(board.atk)) stats.attackBonus = board.atk * 100;
    if (Number.isFinite(board.attack_speed)) {
      stats.aspd = (stats.aspd ?? 0) + board.attack_speed;
    }
    if (Number.isFinite(board.atk_scale)) {
      stats.extraDamageMultiplier =
        (stats.extraDamageMultiplier ?? 0) + board.atk_scale;
    }
    if (Number.isFinite(board.def_penetrate)) {
      stats.defensePenetration = board.def_penetrate;
    }
    if (Number.isFinite(board.magic_resist_penetrate)) {
      stats.resistancePenetration = board.magic_resist_penetrate;
    }
    if (Number.isFinite(board.sp_cost_scale)) {
      stats.spCostMultiplier = board.sp_cost_scale;
    }
  }
  return stats;
}

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

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeSnapshot(outputDir, name, value) {
  const json = JSON.stringify(value);
  fs.writeFileSync(path.join(outputDir, `${name}.json`), json);
  const exportName = `ARK_${name.toUpperCase()}_SNAPSHOT`;
  fs.writeFileSync(
    path.join(outputDir, `${name}.js`),
    `window.${exportName}=${json};\n`,
  );
}

function commandTypeLabel(type) {
  if (type === 1) return '被动协议';
  if (type === 2) return '主动指令';
  return '未解锁指令';
}

function targetLabel(targetType, targetFilterType) {
  const target = {
    COMMON_CHESS: '我方干员',
    SHOP_SLOT: '调度中心单位',
    MAP_TILE: '可选地块',
    NO_TARGET: '无需选择',
  }[targetType];
  const filter = {
    CHAR: '干员',
    EQUIP: '装备',
    PASSABLE: '可通行地块',
    PASSABLE_AND_BUILDABLE: '可部署地块',
  }[targetFilterType];
  return [target, filter].filter(Boolean).join(' · ') || '按效果文本';
}

export function buildReferenceSnapshots({
  activity,
  characters,
  covenants,
  hotUpdateVersion,
  sourcePaths,
}) {
  const season =
    activity.Activity?.Autochess?.act3autochess?.[0]?.V3_1;
  if (!season) throw new Error('V3_1 卫戍协议数据不存在');

  const bondNames = new Map(
    covenants.covenants.map((bond) => [bond.bondId, bond.name]),
  );
  const equipment = Object.values(season.TrapChessDataDict)
    .map((trap) => {
      const effect = season.EffectInfoDataDict?.[trap.EffectId];
      const character = characters[trap.CharId];
      const buffGroups =
        season.EffectBuffInfoDataDict?.[trap.EffectId] ?? [];
      return {
        id: trap.ChessId,
        name: effect?.EffectName || character?.Name || trap.ChessId,
        description: stripGameMarkup(
          effect?.EffectDesc || character?.ItemDesc,
        ),
        bondId: trap.GiveBondId,
        bondName: bondNames.get(trap.GiveBondId) ?? '',
        price: trap.PurchasePrice ?? 0,
        duration: trap.TrapDuration ?? -1,
        effectId: trap.EffectId,
        upgradeId: trap.UpgradeChessId,
        golden: Boolean(trap.IsGolden),
        canFuse: Boolean(trap.CanFuse),
        fuseWith: trap.FuseWith ?? [],
        fuseResult: trap.FuseResult,
        autoStats: extractAutomaticStats(buffGroups),
        parameters: buffGroups.map((group) => group.Blackboard ?? {}),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));

  const commands = Object.values(season.SkillInfoDataDict)
    .map((skill) => {
      const effect = season.EffectInfoDataDict?.[skill.EffectId];
      const band = activity.AutoChessData?.BandDataDict?.[skill.BandId];
      const buffGroups =
        season.EffectBuffInfoDataDict?.[skill.EffectId] ?? [];
      return {
        id: skill.EffectId,
        name: effect?.EffectName || band?.BandName || skill.EffectId,
        description: stripGameMarkup(
          skill.SkillDesc || effect?.EffectDesc,
        ),
        bandId: skill.BandId,
        bandName: band?.BandName ?? '',
        type: skill.SkillType,
        typeLabel: commandTypeLabel(skill.SkillType),
        cost: skill.SkillCost ?? 0,
        availability: skill.SkillAvailCount ?? 0,
        targetType: skill.TargetType,
        targetLabel: targetLabel(
          skill.TargetType,
          skill.TargetFilterType,
        ),
        autoStats: extractAutomaticStats(buffGroups),
        parameters: buffGroups.map((group) => group.Blackboard ?? {}),
      };
    })
    .sort(
      (a, b) =>
        a.type - b.type ||
        a.cost - b.cost ||
        a.name.localeCompare(b.name, 'zh-CN'),
    );

  if (equipment.length < 100) {
    throw new Error(`装备数量异常：${equipment.length}`);
  }
  if (commands.length < 50) {
    throw new Error(`指令数量异常：${commands.length}`);
  }
  if (
    equipment.some((item) => !item.name || !item.description) ||
    commands.some((item) => !item.name || !item.description)
  ) {
    throw new Error('装备或指令缺少名称、效果文本');
  }

  return {
    equipment: {
      source: {
        gameData: sourcePaths.activity,
        characterTable: sourcePaths.characters,
        hotUpdateVersion,
      },
      equipmentCount: equipment.length,
      equipment,
    },
    commands: {
      source: {
        gameData: sourcePaths.activity,
        hotUpdateVersion,
      },
      commandCount: commands.length,
      commands,
    },
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const projectRoot = path.resolve(import.meta.dirname, '..');
  const decodedRoot =
    process.env.ARK_HOT_DECODED ||
    'D:/NEWgame/arknights-extracted/hot-decoded';
  const activityPath = findFile(decodedRoot, 'activity_table071163.json');
  const characterPath = findFile(
    decodedRoot,
    'character_tablec913b6.json',
  );
  if (!activityPath || !characterPath) {
    throw new Error('未找到 V3_1 活动表或干员表');
  }
  const activity = readJson(activityPath);
  const characters = readJson(characterPath).Characters ?? {};
  const covenants = readJson(path.join(projectRoot, 'data/covenants.json'));
  const snapshots = buildReferenceSnapshots({
    activity,
    characters,
    covenants,
    hotUpdateVersion: covenants.source.hotUpdateVersion,
    sourcePaths: { activity: activityPath, characters: characterPath },
  });
  writeSnapshot(
    path.join(projectRoot, 'data'),
    'equipment',
    snapshots.equipment,
  );
  writeSnapshot(
    path.join(projectRoot, 'data'),
    'commands',
    snapshots.commands,
  );
  console.log(
    `Wrote ${snapshots.equipment.equipmentCount} equipment and ${snapshots.commands.commandCount} commands`,
  );
}
