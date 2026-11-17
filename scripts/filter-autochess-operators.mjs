import fs from 'node:fs';
import path from 'node:path';

const projectRoot = path.resolve(import.meta.dirname, '..');
const source = JSON.parse(
  fs.readFileSync(path.join(projectRoot, 'data/operators.json'), 'utf8'),
);
const traits = JSON.parse(
  fs.readFileSync(
    path.join(projectRoot, 'data/autochess-traits.json'),
    'utf8',
  ),
);
const eligibleIds = new Set(traits.traits.map((trait) => trait.charId));
const operators = source.operators.filter(
  (operator) =>
    eligibleIds.has(operator.id) &&
    operator.profession &&
    operator.stats,
);

if (operators.length < 100) {
  throw new Error(`卫戍干员数量异常：${operators.length}`);
}
if (!operators.some((operator) => operator.id === 'char_618_acrbot')) {
  throw new Error('森蚺特殊干员“暴躁铁皮”缺失');
}

const result = {
  source: {
    fullOperatorCount: source.operators.length,
    traitCount: traits.traitCount,
    hotUpdateVersion: source.source?.hotUpdateVersion,
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
console.log(`Wrote ${operators.length} autochess operators`);
