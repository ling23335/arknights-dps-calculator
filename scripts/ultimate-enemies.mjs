import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const MODE_ID = 'mode_multi_abyss';

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

function round(value) {
  return value === null || value === undefined
    ? value
    : Math.round(value * 1000) / 1000;
}

export function applyUltimateEnemyStats(snapshot, activity) {
  const season =
    activity.Activity?.Autochess?.act3autochess?.[0]?.V3_1;
  const autoData = activity.AutoChessData;
  const mode = season?.ModeDataDict?.[MODE_ID];
  if (!season || !mode) throw new Error('终极模拟模式不存在');

  const constants = autoData.ConstData;
  const bossByEnemy = new Map(
    Object.values(autoData.BossInfoDict ?? {})
      .filter((boss) => boss.EnemyId)
      .map((boss) => [boss.EnemyId, boss.BossId]),
  );
  const factors = {
    mode: mode.Factor,
    attack: constants.EnemyAtkFactor,
    defense: constants.EnemyDefFactor,
    resistance: constants.EnemyMagicResistanceFactor,
  };

  const enemies = snapshot.enemies.map((enemy) => {
    const bossId = enemy.bossId ?? bossByEnemy.get(enemy.enemyId);
    const bossHp =
      season.BossInfoDict?.[bossId]?.BloodDataDict?.[MODE_ID] ?? null;
    const battleEffectiveness =
      autoData.RandomEnemyAttributeDict?.[enemy.enemyId]
        ?.EnemyBattleEffectivenessFactor ?? 1;
    const base = {
      hp: enemy.baseHp ?? enemy.hp,
      attack: enemy.baseAttack ?? enemy.attack,
      defense: enemy.baseDefense ?? enemy.defense,
      resistance: enemy.baseResistance ?? enemy.resistance,
    };
    const ultimate = {
      hp: bossHp ?? base.hp * factors.mode,
      attack: base.attack * factors.attack * factors.mode,
      defense: base.defense * factors.defense * factors.mode,
      resistance: Math.min(100, base.resistance * factors.resistance),
    };
    return {
      ...enemy,
      baseHp: round(base.hp),
      baseAttack: round(base.attack),
      baseDefense: round(base.defense),
      baseResistance: round(base.resistance),
      hp: round(ultimate.hp),
      attack: round(ultimate.attack),
      defense: round(ultimate.defense),
      resistance: round(ultimate.resistance),
      battleEffectivenessFactor: battleEffectiveness,
      ultimate: {
        modeId: MODE_ID,
        modeName: mode.Name,
        modeFactor: factors.mode,
        attackFactor: factors.attack,
        defenseFactor: factors.defense,
        resistanceFactor: factors.resistance,
        hpSource: bossHp === null ? 'base × mode factor' : 'boss blood table',
      },
    };
  });

  if (
    enemies.some(
      (enemy) =>
        !Number.isFinite(enemy.hp) ||
        !Number.isFinite(enemy.attack) ||
        !Number.isFinite(enemy.defense) ||
        !Number.isFinite(enemy.resistance),
    )
  ) {
    throw new Error('终极敌人属性存在非有限值');
  }

  return {
    ...snapshot,
    source: {
      ...snapshot.source,
      ultimateMode: MODE_ID,
    },
    ultimateMode: {
      id: MODE_ID,
      name: mode.Name,
      difficulty: mode.Difficulty,
      factors,
    },
    enemyCount: enemies.length,
    enemies,
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const projectRoot = path.resolve(import.meta.dirname, '..');
  const snapshot = JSON.parse(
    fs.readFileSync(path.join(projectRoot, 'data/enemies.json'), 'utf8'),
  );
  const covenantSource = JSON.parse(
    fs.readFileSync(path.join(projectRoot, 'data/covenants.json'), 'utf8'),
  ).source.gameData;
  const decodedRoot =
    process.env.ARK_HOT_DECODED ||
    'D:/NEWgame/arknights-extracted/hot-decoded';
  const activityPath =
    fs.existsSync(covenantSource)
      ? covenantSource
      : findFile(decodedRoot, 'activity_table071163.json');
  const activity = JSON.parse(fs.readFileSync(activityPath, 'utf8'));
  const result = applyUltimateEnemyStats(snapshot, activity);
  const json = JSON.stringify(result);
  fs.writeFileSync(path.join(projectRoot, 'data/enemies.json'), json);
  fs.writeFileSync(
    path.join(projectRoot, 'data/enemies.js'),
    `window.ARK_ENEMY_SNAPSHOT=${json};\n`,
  );
  console.log(
    `Wrote ${result.enemyCount} ${result.ultimateMode.name} enemies`,
  );
}
