import fs from 'node:fs';
import path from 'node:path';

const activityPath =
  process.argv[2] ??
  'D:/NEWgame/arknights-extracted/hot-decoded/a0030fbe9e5958420310f5ecd71d66ef/activity_table071163.json';
const characterPath =
  process.argv[3] ??
  'D:/NEWgame/arknights-extracted/hot-decoded/74976659a5aaaf0dc4df9ae2506c2a59/character_tablec913b6.json';
const snapshotPath =
  process.argv[4] ??
  path.resolve('data/autochess-traits.json');

const activity = JSON.parse(fs.readFileSync(activityPath, 'utf8'));
const characters = JSON.parse(
  fs.readFileSync(characterPath, 'utf8'),
).Characters;
const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
const version = activity.Activity.Autochess.act3autochess[0].V3_1;
const chessData = version.CharChessDataDict;
const shopData = version.CharShopChessDatas;

const raw = [];
for (const entry of Object.values(shopData)) {
  if (!entry?.ChessId?.endsWith('_a')) continue;
  const chess = chessData[entry.ChessId];
  if (!chess || !Array.isArray(chess.BondIds)) continue;
  raw.push({
    charId: entry.CharId,
    name: characters[entry.CharId]?.Name ?? entry.CharId,
    chessId: entry.ChessId,
    bondIds: [...chess.BondIds].sort(),
    description: chess.Desc,
  });
}

const derivedById = new Map(
  (snapshot.traits ?? []).map((trait) => [trait.charId, trait]),
);
const mismatches = [];
const missing = [];
for (const row of raw) {
  const derived = derivedById.get(row.charId);
  if (!derived) {
    missing.push(row);
    continue;
  }
  const bondIds = [...(derived.bondIds ?? [])].sort();
  if (JSON.stringify(bondIds) !== JSON.stringify(row.bondIds)) {
    mismatches.push({
      ...row,
      derivedBondIds: bondIds,
    });
  }
}
const rawIds = new Set(raw.map((row) => row.charId));
const extra = (snapshot.traits ?? []).filter(
  (trait) => !rawIds.has(trait.charId),
);

console.log(
  `raw=${raw.length} derived=${derivedById.size} mismatches=${mismatches.length} missing=${missing.length} extra=${extra.length}`,
);
for (const row of raw.sort((a, b) =>
  a.name.localeCompare(b.name, 'zh-CN'),
)) {
  console.log(
    `${row.name}\t${row.charId}\t${row.bondIds.join(',')}\t${row.chessId}`,
  );
}
if (mismatches.length || missing.length || extra.length) {
  console.error(
    JSON.stringify({ mismatches, missing, extra }, null, 2),
  );
  process.exitCode = 1;
}
