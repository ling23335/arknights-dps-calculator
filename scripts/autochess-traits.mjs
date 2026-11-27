import fs from 'node:fs';
import path from 'node:path';
import { stripGameMarkup } from './reference-data.mjs';

const projectRoot = path.resolve(import.meta.dirname, '..');
const covenants = JSON.parse(
  fs.readFileSync(path.join(projectRoot, 'data/covenants.json'), 'utf8'),
);
const activity = JSON.parse(
  fs.readFileSync(covenants.source.gameData, 'utf8'),
);
const characters = JSON.parse(
  fs.readFileSync(covenants.source.characterTable, 'utf8'),
).Characters;
const season = activity.Activity.Autochess.act3autochess[0].V3_1;
const traits = new Map();

for (const shop of Object.values(season.CharShopChessDatas)) {
  const chess = season.CharChessDataDict[shop.ChessId];
  if (!shop.CharId || !chess?.Desc) continue;
  const current = traits.get(shop.CharId);
  if (current && current.level > (shop.ChessLevel ?? 0)) continue;
  const garrisonIds = chess.GarrisonIds ?? [];
  const garrisons = garrisonIds.flatMap((garrisonId) => {
    const garrison = season.GarrisonDataDict?.[garrisonId];
    return garrison
      ? [
          {
            id: garrisonId,
            eventType: garrison.EventType,
            eventTypeDesc: garrison.EventTypeDesc,
            effectType: garrison.EffectType,
            description: stripGameMarkup(
              garrison.Description || garrison.GarrisonDesc,
            ),
            blackboard: garrison.Blackboard ?? {},
            battleRuneKey: garrison.BattleRuneKey ?? null,
          },
        ]
      : [];
  });
  traits.set(shop.CharId, {
    charId: shop.CharId,
    name: characters[shop.CharId]?.Name ?? shop.CharId,
    chessId: shop.ChessId,
    level: shop.ChessLevel ?? 0,
    bondIds: chess.BondIds ?? [],
    garrisonIds,
    garrisons,
    description: stripGameMarkup(chess.Desc),
  });
}

const result = {
  source: {
    gameData: covenants.source.gameData,
    hotUpdateVersion: covenants.source.hotUpdateVersion,
  },
  traitCount: traits.size,
  traits: [...traits.values()].sort((a, b) =>
    a.name.localeCompare(b.name, 'zh-CN'),
  ),
};

if (result.traitCount < 100) {
  throw new Error(`卫戍干员特质数量异常：${result.traitCount}`);
}

const json = JSON.stringify(result);
fs.writeFileSync(
  path.join(projectRoot, 'data/autochess-traits.json'),
  json,
);
fs.writeFileSync(
  path.join(projectRoot, 'data/autochess-traits.js'),
  `window.ARK_AUTOCHESS_TRAITS_SNAPSHOT=${json};\n`,
);
console.log(`Wrote ${result.traitCount} autochess character traits`);
