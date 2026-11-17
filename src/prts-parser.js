function splitTemplate(source) {
  const inner = source.slice(2, -2);
  const parts = [];
  let depth = 0;
  let start = 0;

  for (let i = 0; i < inner.length - 1; i += 1) {
    const pair = inner.slice(i, i + 2);
    if (pair === '{{') {
      depth += 1;
      i += 1;
    } else if (pair === '}}') {
      depth -= 1;
      i += 1;
    } else if (inner[i] === '|' && depth === 0) {
      parts.push(inner.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(inner.slice(start));
  return parts;
}

function templateName(source) {
  return splitTemplate(source)[0]
    .replace(/<!--[\s\S]*?-->/g, '')
    .trim()
    .split(/\r?\n/)[0]
    .trim()
    .replace(/^模板:/, '');
}

function templateFields(source) {
  const fields = {};
  for (const part of splitTemplate(source).slice(1)) {
    let depth = 0;
    let equals = -1;
    for (let i = 0; i < part.length - 1; i += 1) {
      const pair = part.slice(i, i + 2);
      if (pair === '{{') {
        depth += 1;
        i += 1;
      } else if (pair === '}}') {
        depth -= 1;
        i += 1;
      } else if (part[i] === '=' && depth === 0) {
        equals = i;
        break;
      }
    }
    if (equals < 0) continue;
    fields[part.slice(0, equals).trim()] = part.slice(equals + 1).trim();
  }
  return fields;
}

function collectTemplates(source) {
  const templates = [];
  for (let i = 0; i < source.length - 1; i += 1) {
    if (source.slice(i, i + 2) !== '{{' || source[i + 2] === '{') continue;
    let depth = 0;
    for (let j = i; j < source.length - 1; j += 1) {
      const pair = source.slice(j, j + 2);
      if (pair === '{{') {
        depth += 1;
        j += 1;
      } else if (pair === '}}') {
        depth -= 1;
        j += 1;
        if (depth === 0) {
          templates.push(source.slice(i, j + 1));
          i = j;
          break;
        }
      }
    }
  }
  return templates;
}

function numberFrom(value) {
  const match = String(value ?? '').match(/[-+]?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

export function stripWikiText(value) {
  let text = String(value ?? '');
  text = text.replace(/<!--[\s\S]*?-->/g, '');
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<\/?[^>]+>/g, '');
  text = text.replace(/\[\[[^\]|]+\|([^\]]+)\]\]/g, '$1');
  text = text.replace(/\[\[([^\]]+)\]\]/g, '$1');

  let previous;
  do {
    previous = text;
    text = text.replace(/\{\{([^{}]+)\}\}/g, (_, body) => {
      const parts = body.split('|');
      return parts.at(-1) ?? '';
    });
  } while (text !== previous);

  return text
    .replace(/'''?/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function statBlock(fields) {
  const make = (elite) => ({
    hp: numberFrom(fields[`精英${elite}_满级_生命上限`]),
    attack: numberFrom(fields[`精英${elite}_满级_攻击`]),
    defense: numberFrom(fields[`精英${elite}_满级_防御`]),
    resistance: numberFrom(fields[`精英${elite}_满级_法术抗性`]),
  });
  const maxElite = fields.精英2_满级 ? '2' : fields.精英1_满级 ? '1' : '0';
  return {
    attackInterval: numberFrom(fields.攻击速度),
    redeploy: numberFrom(fields.再部署),
    cost: numberFrom(fields.部署费用),
    block: numberFrom(fields.阻挡数),
    e0: make('0'),
    e1: make('1'),
    e2: make('2'),
    maxElite: Number(maxElite),
    trust: {
      hp: numberFrom(fields.信赖加成_生命上限) ?? 0,
      attack: numberFrom(fields.信赖加成_攻击) ?? 0,
      defense: numberFrom(fields.信赖加成_防御) ?? 0,
    },
  };
}

function potentialMods(fields) {
  const values = String(fields.潜能 ?? '').split(',');
  const types = String(fields.潜能类型 ?? '').split(',');
  return values.flatMap((value, index) => {
    const type = types[index]?.trim();
    const amount = numberFrom(value);
    return type && amount !== null ? [{ level: index + 2, type, amount }] : [];
  });
}

function parseSkill(source) {
  const fields = templateFields(source);
  const names = {
    技能1: '1',
    技能2: '2',
    技能3: '3',
    技能4: '4',
    技能5: '5',
    技能6: '6',
    技能7: '7',
    技能专精1: 'M1',
    技能专精2: 'M2',
    技能专精3: 'M3',
  };
  const levels = {};
  for (const [prefix, level] of Object.entries(names)) {
    if (!(fields[`${prefix}描述`] || fields[`${prefix}消耗`])) continue;
    levels[level] = {
      description: stripWikiText(fields[`${prefix}描述`]),
      initial: numberFrom(fields[`${prefix}初始`]),
      cost: numberFrom(fields[`${prefix}消耗`]),
      duration: numberFrom(fields[`${prefix}持续`]),
    };
  }
  return {
    name: stripWikiText(fields.技能名),
    skillType: stripWikiText(fields.技能类型1),
    triggerType: stripWikiText(fields.技能类型2),
    range: fields.技能范围 ?? '',
    levels,
  };
}

function parseTalents(templates) {
  return templates
    .filter((source) => ['天赋列表3', '天赋列表'].includes(templateName(source)))
    .flatMap((source) => {
      const fields = templateFields(source);
      return [1, 2, 3, 4]
        .filter((index) => fields[`天赋${index}`])
        .map((index) => ({
          group: fields.天赋,
          name: stripWikiText(fields[`天赋${index}`]),
          condition: stripWikiText(fields[`天赋${index}条件`]),
          effect: stripWikiText(fields[`天赋${index}效果`]),
        }));
    });
}

function parseModules(templates) {
  return templates
    .filter((source) => templateName(source) === '模组')
    .map((source) => templateFields(source))
    .filter((fields) => fields.基础证章 !== 'yes' && fields.名称)
    .map((fields) => ({
      name: stripWikiText(fields.名称),
      attack: numberFrom(fields.攻击3) ?? numberFrom(fields.攻击) ?? 0,
      hp: numberFrom(fields.生命3) ?? numberFrom(fields.生命) ?? 0,
      trait: stripWikiText(fields.特性),
      upgradedTalent: stripWikiText(fields.天赋3 ?? fields.天赋2),
    }));
}

export function parseOperatorWikitext(source, pageTitle = '') {
  const templates = collectTemplates(source);
  const find = (name) => templates.find((item) => templateName(item) === name);
  const infoSource = find('CharinfoV2') ?? find('Charinfo');
  const statsSource = find('属性');
  if (!infoSource || !statsSource) return null;

  const info = templateFields(infoSource);
  const stats = statBlock(templateFields(statsSource));
  const skillTemplates = templates.filter((item) =>
    ['技能', '技能2'].includes(templateName(item)),
  );

  return {
    id: info.干员id ?? pageTitle,
    page: pageTitle || stripWikiText(info.干员名),
    name: stripWikiText(info.干员名),
    nameEn: stripWikiText(info.干员外文名),
    rarity: numberFrom(info.稀有度) === null ? null : numberFrom(info.稀有度) + 1,
    profession: stripWikiText(info.职业),
    branch: stripWikiText(info.分支),
    position: stripWikiText(info.位置),
    tags: stripWikiText(info.标签).split(/\s+/).filter(Boolean),
    trait: stripWikiText(info.特性),
    stats,
    potential: {
      mods: potentialMods(templateFields(statsSource)),
    },
    skills: skillTemplates.map(parseSkill).filter((skill) => skill.name),
    talents: parseTalents(templates),
    modules: parseModules(templates),
  };
}
