from __future__ import annotations

import argparse
import builtins
import json
import sys
from pathlib import Path


MODE_IDS = [
    "mode_multi_funny",
    "mode_multi_normal",
    "mode_multi_hard",
    "mode_multi_abyss",
]
DEFAULT_ACTIVITY = Path(
    r"D:\NEWgame\arknights-extracted\hot-decoded"
    r"\a0030fbe9e5958420310f5ecd71d66ef\activity_table071163.json"
)
DEFAULT_ENEMY_DB = Path(
    r"D:\NEWgame\arknights-extracted\hot-decoded"
    r"\605f70adca6554eb8bcb869ccd1418ea\enemy_database0e81c0.json"
)
DEFAULT_LEVEL_DIR = Path(
    r"D:\NEWgame\arknights-extracted\autochess-bundle-output"
    r"\bfe1215bfd84cb2fc9d29eb17a5a8018"
)
DEFAULT_FBS_DIR = Path(r"D:\NEWgame\tools\ark-fbs-py\CN")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Extract AutoChess multiplayer rounds from local level FlatBuffers."
    )
    parser.add_argument("--activity", type=Path, default=DEFAULT_ACTIVITY)
    parser.add_argument("--enemy-db", type=Path, default=DEFAULT_ENEMY_DB)
    parser.add_argument("--level-dir", type=Path, default=DEFAULT_LEVEL_DIR)
    parser.add_argument("--fbs-dir", type=Path, default=DEFAULT_FBS_DIR)
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "data",
    )
    return parser.parse_args()


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def enemy_level_zero_hp(enemy_db: dict, enemy_id: str):
    records = enemy_db.get(enemy_id) or []
    if not records:
        return None
    record = next(
        (item for item in records if int(item.get("Level", 0)) == 0),
        records[0],
    )
    return (
        record.get("EnemyData", {})
        .get("Attributes", {})
        .get("MaxHp", {})
        .get("MValue")
    )


def fbs_scalar(value):
    if value is None:
        return None
    if hasattr(value, "MValue"):
        return fbs_scalar(value.MValue())
    return value


def fbs_enemy_stats(enemy_data) -> dict:
    attributes = enemy_data.Attributes()
    if not attributes:
        return {}
    return {
        "hp": fbs_scalar(attributes.MaxHp()),
        "attack": fbs_scalar(attributes.Atk()),
        "defense": fbs_scalar(attributes.Def()),
        "resistance": fbs_scalar(attributes.MagicResistance()),
        "attackInterval": fbs_scalar(attributes.BaseAttackTime()),
        "attackSpeed": fbs_scalar(attributes.AttackSpeed()),
        "moveSpeed": fbs_scalar(attributes.MoveSpeed()),
        "massLevel": fbs_scalar(attributes.MassLevel()),
    }


def round_number(value: float) -> float:
    return builtins.round(value, 3)


def rounded_int(value: float) -> int:
    return int(round_number(value))


def main() -> None:
    args = parse_args()
    sys.path.insert(0, str(args.fbs_dir))
    import prts___levels as level_fbs  # pylint: disable=import-outside-toplevel

    activity = read_json(args.activity)
    enemy_db = read_json(args.enemy_db).get("Enemies", {})
    season = activity["Activity"]["Autochess"]["act3autochess"][0]["V3_1"]
    auto_data = activity.get("AutoChessData", {})
    constants = auto_data.get("ConstData", {})
    boss_data = auto_data.get("BossInfoDict", {})
    boss_id_by_enemy = {
        boss.get("EnemyId"): boss_id
        for boss_id, boss in boss_data.items()
        if boss.get("EnemyId")
    }
    mode_factors = {
        mode_id: float(season["ModeDataDict"][mode_id]["Factor"])
        for mode_id in MODE_IDS
    }
    boss_hp_by_mode = {}
    for boss_id, boss in season.get("BossInfoDict", {}).items():
        blood = boss.get("BloodDataDict", {})
        boss_hp_by_mode[boss_id] = {
            mode_id: blood.get(mode_id)
            for mode_id in MODE_IDS
            if blood.get(mode_id) is not None
        }

    enemy_effects = []
    for effect_id, effect in season.get("EffectInfoDataDict", {}).items():
        if not effect_id.startswith("aceffect_enemy_"):
            continue
        hp_multiplier = 1.0
        attack_multiplier = 1.0
        attack_speed_add = 0.0
        move_speed_add = 0.0
        enemy_exclude = 0
        buffs = season.get("EffectBuffInfoDataDict", {}).get(effect_id, [])
        for buff in buffs:
            board = buff.get("Blackboard", {})
            enemy_exclude = max(
                enemy_exclude, int(board.get("enemy_exclude", 0) or 0)
            )
            if buff.get("Key") == "enemy_attribute_mul":
                hp_multiplier *= float(board.get("max_hp", 1) or 1)
                attack_multiplier *= float(board.get("atk", 1) or 1)
            elif buff.get("Key") == "enemy_attribute_add":
                attack_speed_add += float(board.get("attack_speed", 0) or 0)
            elif buff.get("Key") == "env_gbuff_new":
                move_speed_add += float(board.get("move_speed", 0) or 0)
        enemy_effects.append(
            {
                "id": effect_id,
                "name": effect.get("EffectName") or effect_id,
                "description": effect.get("EffectDesc") or "",
                "hpMultiplier": round_number(hp_multiplier),
                "attackMultiplier": round_number(attack_multiplier),
                "attackSpeedAdd": round_number(attack_speed_add),
                "moveSpeedAdd": round_number(move_speed_add),
                "enemyExclude": enemy_exclude,
                "buffs": buffs,
            }
        )

    random_enemy_dict = (
        activity.get("AutoChessData", {}).get("RandomEnemyAttributeDict", {})
    )
    random_enemy_attributes = {
        "count": len(random_enemy_dict),
        "levelValues": sorted(
            {int(item.get("Level", 0)) for item in random_enemy_dict.values()}
        ),
        "effectivenessValues": sorted(
            {
                float(item.get("EnemyBattleEffectivenessFactor", 1))
                for item in random_enemy_dict.values()
            }
        ),
        "flyEnemyCount": sum(
            bool(item.get("IsFlyEnemy")) for item in random_enemy_dict.values()
        ),
        "extraIdentifierCount": sum(
            int(item.get("ExtraEnemyIdentifier", 0) or 0) > 0
            for item in random_enemy_dict.values()
        ),
    }

    global_enemy_data_path = (
        args.level_dir
        / str(constants.get("EnemyDataLevelId", "")).split("/")[-1]
    )
    global_enemy_overrides = {}
    if global_enemy_data_path.exists():
        global_payload = global_enemy_data_path.read_bytes()
        global_root = level_fbs.ROOT_TYPE.GetRootAs(
            bytearray(global_payload)[128:], 0
        )
        for ref_index in range(global_root.EnemyDbRefsLength()):
            ref = global_root.EnemyDbRefs(ref_index)
            enemy_id = ref.Id().decode("utf-8") if ref.Id() else ""
            overwritten = ref.OverwrittenData()
            if enemy_id and overwritten:
                global_enemy_overrides[enemy_id] = {
                    "level": int(ref.Level()),
                    "useDb": bool(ref.UseDb()),
                    "stats": fbs_enemy_stats(overwritten),
                }

    def effect_rows(prefix: str, action_key: str):
        rows = []
        for effect_id, effect in season.get("EffectInfoDataDict", {}).items():
            if not effect_id.startswith(prefix):
                continue
            rows.append(
                {
                    "id": effect_id,
                    "name": effect.get("EffectName") or effect_id,
                    "description": effect.get("EffectDesc") or "",
                    "effectType": int(effect.get("EffectType", 0)),
                    action_key: season.get("EffectBuffInfoDataDict", {}).get(
                        effect_id, []
                    ),
                }
            )
        return rows

    special_enemy_pools = {}
    for enemy_id, info in season.get("SpecialEnemyInfoDict", {}).items():
        enemy_type = info.get("Type") or "SPECIAL"
        bucket = special_enemy_pools.setdefault(
            enemy_type,
            {
                "count": 0,
                "firstHalfCount": 0,
                "weight": 0,
                "entries": [],
            },
        )
        bucket["count"] += 1
        bucket["firstHalfCount"] += int(bool(info.get("IsInFirstHalf")))
        bucket["weight"] += int(info.get("RandomWeight", 0) or 0)
        bucket["entries"].append(
            {
                "enemyId": enemy_id,
                "attachedNormalEnemyKeys": info.get(
                    "AttachedNormalEnemyKeys", []
                ),
                "attachedEliteEnemyKeys": info.get(
                    "AttachedEliteEnemyKeys", []
                ),
                "randomWeight": info.get("RandomWeight", 0),
                "isInFirstHalf": bool(info.get("IsInFirstHalf")),
            }
        )

    card_pool = {}
    for shop in season.get("CharShopChessDatas", {}).values():
        level = int(shop.get("ChessLevel", 0) or 0)
        bucket = card_pool.setdefault(
            str(level), {"all": [], "visible": []}
        )
        bucket["all"].append(shop["ChessId"])
        if not shop.get("IsHidden"):
            bucket["visible"].append(shop["ChessId"])
    shop_levels = {}
    for mode_id, levels_list in season.get("ShopLevelDataDict", {}).items():
        level_map = {}
        for entry in levels_list:
            for level, config in entry.items():
                level_map[str(level)] = {
                    "charChessCount": config.get("CharChessCount"),
                    "itemCount": config.get("ItemCount"),
                    "initialUpgradePrice": config.get(
                        "InitialUpgradePrice"
                    ),
                }
        shop_levels[mode_id] = level_map

    all_mode_summaries = {}
    for mode_id, mode in season.get("ModeDataDict", {}).items():
        all_mode_summaries[mode_id] = {
            "id": mode_id,
            "name": mode.get("Name"),
            "modeType": mode.get("ModeType"),
            "difficulty": mode.get("Difficulty"),
            "difficultyDesc": mode.get("DifficultyDesc"),
            "factor": mode.get("Factor"),
            "roundCount": len(season.get("BattleDataDict", {}).get(mode_id, [])),
            "activeBondCount": len(mode.get("ActiveBondIdList") or []),
            "inactiveBondCount": len(mode.get("InactiveBondIdList") or []),
            "inactiveEnemyCount": len(mode.get("InactiveEnemyKey") or []),
        }

    levels = {}
    missing_hp = set()

    def parse_level(level_ref: str) -> dict:
        if level_ref in levels:
            return levels[level_ref]
        level_name = level_ref.split("/")[-1]
        path = args.level_dir / level_name
        if not path.exists():
            raise FileNotFoundError(f"Missing level asset: {path}")
        payload = path.read_bytes()
        if len(payload) <= 128:
            raise ValueError(f"Invalid signed level asset: {path}")
        root = level_fbs.ROOT_TYPE.GetRootAs(bytearray(payload)[128:], 0)
        options = root.Options()
        level_options = (
            {
                "characterLimit": int(options.CharacterLimit()),
                "maxLifePoint": int(options.MaxLifePoint()),
                "initialCost": int(options.InitialCost()),
                "maxCost": int(options.MaxCost()),
                "maxPlayTime": float(options.MaxPlayTime()),
            }
            if options
            else None
        )
        enemy_overrides = {}
        enemy_refs = []
        for ref_index in range(root.EnemyDbRefsLength()):
            ref = root.EnemyDbRefs(ref_index)
            enemy_id = ref.Id().decode("utf-8") if ref.Id() else ""
            overwritten = ref.OverwrittenData()
            override_stats = fbs_enemy_stats(overwritten) if overwritten else {}
            enemy_refs.append(
                {
                    "enemyId": enemy_id,
                    "level": int(ref.Level()),
                    "useDb": bool(ref.UseDb()),
                    "overwritten": override_stats,
                }
            )
            if enemy_id and override_stats:
                enemy_overrides[enemy_id] = override_stats

        def effective_hp(enemy_id: str):
            override_hp = int(enemy_overrides.get(enemy_id, {}).get("hp") or 0)
            if override_hp > 0:
                return override_hp, "level-override"
            global_hp = int(
                global_enemy_overrides.get(enemy_id, {})
                .get("stats", {})
                .get("hp")
                or 0
            )
            if global_hp > 0:
                return global_hp, "autochess-enemy-data-override"
            database_hp = enemy_level_zero_hp(enemy_db, enemy_id)
            return database_hp, "enemy-database-level-0"

        def parse_action_table(table, destination):
            if not table:
                return
            for action_index in range(table.ActionsLength()):
                action = table.Actions(action_index)
                if action.ActionType() != 0:
                    continue
                enemy_id = (
                    action.Key().decode("utf-8")
                    if action.Key()
                    else ""
                )
                if not enemy_id:
                    continue
                count = int(action.Count())
                base_hp, hp_source = effective_hp(enemy_id)
                if base_hp is None:
                    missing_hp.add(enemy_id)
                boss_id = boss_id_by_enemy.get(enemy_id)
                destination.append(
                    {
                        "enemyId": enemy_id,
                        "count": count,
                        "preDelay": float(action.PreDelay()),
                        "interval": float(action.Interval()),
                        "routeIndex": int(action.RouteIndex()),
                        "randomType": int(action.RandomType()),
                        "hiddenGroup": (
                            action.HiddenGroup().decode("utf-8")
                            if action.HiddenGroup()
                            else None
                        ),
                        "bossId": boss_id,
                        "baseHp": base_hp,
                        "baseHpSource": hp_source,
                    }
                )

        actions = []
        for wave_index in range(root.WavesLength()):
            wave = root.Waves(wave_index)
            for fragment_index in range(wave.FragmentsLength()):
                parse_action_table(
                    wave.Fragments(fragment_index), actions
                )

        conditional_branches = []
        for branch_index in range(root.BranchesLength()):
            branch_entry = root.Branches(branch_index)
            branch_id = (
                branch_entry.Key().decode("utf-8")
                if branch_entry.Key()
                else f"branch_{branch_index}"
            )
            branch = branch_entry.Value()
            branch_actions = []
            for phase_index in range(branch.PhasesLength()):
                parse_action_table(
                    branch.Phases(phase_index), branch_actions
                )
            conditional_branches.append(
                {
                    "branchId": branch_id,
                    "actions": branch_actions,
                    "enemyIds": sorted(
                        {action["enemyId"] for action in branch_actions}
                    ),
                    "spawnCount": sum(
                        int(action["count"]) for action in branch_actions
                    ),
                }
            )
        normal_base_hp = sum(
            int(action["count"]) * int(action.get("baseHp") or 0)
            for action in actions
            if not action.get("bossId")
        )
        result = {
            "levelName": level_name,
            "actions": actions,
            "enemyIds": sorted({action["enemyId"] for action in actions}),
            "bossIds": sorted(
                {action["bossId"] for action in actions if action.get("bossId")}
            ),
            "normalBaseHp": normal_base_hp,
            "spawnCount": sum(int(action["count"]) for action in actions),
            "conditionalBranches": conditional_branches,
            "enemyRefs": enemy_refs,
            "enemyOverrides": enemy_overrides,
            "options": level_options,
        }
        levels[level_ref] = result
        return result

    modes = {}
    for mode_id in MODE_IDS:
        mode = season["ModeDataDict"][mode_id]
        factor = mode_factors[mode_id]
        rounds = []
        for battle_entry in season["BattleDataDict"][mode_id]:
            battle_round, variants = next(iter(battle_entry.items()))
            variant_rows = []
            for variant in variants:
                level = parse_level(variant["LevelId"])
                conditional_branches = [
                    {
                        "branchId": branch["branchId"],
                        "spawnCount": branch["spawnCount"],
                        "enemyIds": branch["enemyIds"],
                    }
                    for branch in level["conditionalBranches"]
                ]
                variant_rows.append(
                    {
                        "levelId": variant["LevelId"],
                        "levelName": level["levelName"],
                        "bossId": variant.get("BossId"),
                        "isSpPrepare": bool(variant.get("IsSpPrepare")),
                        "normalHp": rounded_int(
                            level["normalBaseHp"] * factor
                        ),
                        "spawnCount": level["spawnCount"],
                        "randomSpawnCount": sum(
                            int(action["count"])
                            for action in level["actions"]
                            if int(action.get("randomType", 0)) != 0
                        ),
                        "hiddenSpawnCount": sum(
                            int(action["count"])
                            for action in level["actions"]
                            if action.get("hiddenGroup")
                        ),
                        "conditionalBranchCount": len(
                            conditional_branches
                        ),
                        "conditionalSpawnCount": sum(
                            branch["spawnCount"]
                            for branch in conditional_branches
                        ),
                        "conditionalBranches": conditional_branches,
                        "enemyOverrides": level["enemyOverrides"],
                        "maxPlayTime": (
                            level["options"]["maxPlayTime"]
                            if level["options"]
                            else None
                        ),
                        "characterLimit": (
                            level["options"]["characterLimit"]
                            if level["options"]
                            else None
                        ),
                    }
                )
            normal_values = [item["normalHp"] for item in variant_rows]
            enemy_ids = sorted(
                {
                    enemy_id
                    for variant in variant_rows
                    for enemy_id in levels[variant["levelId"]]["enemyIds"]
                }
            )
            rounds.append(
                {
                    "round": int(battle_round),
                    "isSpPrepare": any(
                        item["isSpPrepare"] for item in variant_rows
                    ),
                    "normalHpMin": min(normal_values),
                    "normalHpMax": max(normal_values),
                    "randomSpawnCount": sum(
                        item["randomSpawnCount"] for item in variant_rows
                    ),
                    "hiddenSpawnCount": sum(
                        item["hiddenSpawnCount"] for item in variant_rows
                    ),
                    "conditionalBranchIds": sorted(
                        {
                            branch["branchId"]
                            for item in variant_rows
                            for branch in item["conditionalBranches"]
                        }
                    ),
                    "conditionalSpawnCount": sum(
                        item["conditionalSpawnCount"]
                        for item in variant_rows
                    ),
                    "enemyIds": enemy_ids,
                    "bossIds": sorted(
                        {
                            item["bossId"]
                            for item in variant_rows
                            if item.get("bossId")
                        }
                    ),
                    "variants": variant_rows,
                }
            )
        modes[mode_id] = {
            "id": mode_id,
            "name": mode["Name"],
            "code": mode["Code"],
            "difficulty": int(mode["Difficulty"]),
            "factor": factor,
            "roundCount": len(rounds),
            "activeBondIds": mode.get("ActiveBondIdList") or [],
            "inactiveBondIds": mode.get("InactiveBondIdList") or [],
            "inactiveEnemyKeys": mode.get("InactiveEnemyKey") or [],
            "eventIds": mode.get("EventIds") or [],
            "modeType": mode.get("ModeType"),
            "difficultyDesc": mode.get("DifficultyDesc"),
            "description": mode.get("Desc"),
            "rounds": rounds,
        }

    if missing_hp:
        raise ValueError(
            f"Enemy database misses {len(missing_hp)} spawn keys: "
            + ", ".join(sorted(missing_hp)[:20])
        )
    if len(modes) != 4:
        raise ValueError("Expected exactly four multiplayer modes")
    if [modes[mode_id]["roundCount"] for mode_id in MODE_IDS] != [14, 15, 15, 15]:
        raise ValueError("Unexpected multiplayer round counts")
    if bosses := boss_hp_by_mode.get("boss_15", {}):
        if bosses.get("mode_multi_abyss") != 7885000:
            raise ValueError("Unexpected boss_15 abyss HP")

    snapshot = {
        "source": {
            "gameData": str(args.activity),
            "enemyDatabase": str(args.enemy_db),
            "levelBundle": str(args.level_dir),
            "levelSchema": str(args.fbs_dir / "prts___levels.py"),
        },
        "factors": {
            "attack": constants.get("EnemyAtkFactor", 5),
            "defense": constants.get("EnemyDefDefenseFactor", 3)
            if constants.get("EnemyDefDefenseFactor") is not None
            else constants.get("EnemyDefFactor", 3),
            "resistance": constants.get("EnemyMagicResistanceFactor", 3),
            "hp": constants.get("EnemyMaxHpFactor", 1),
        },
        "modeOrder": MODE_IDS,
        "modes": modes,
        "allModeOrder": list(season.get("ModeDataDict", {}).keys()),
        "allModes": all_mode_summaries,
        "modeGroups": season.get("ModeGroupDataDict", {}),
        "tableCounts": {
            "modes": len(season.get("ModeDataDict", {})),
            "battleModeEntries": len(season.get("BattleDataDict", {})),
            "bonds": len(season.get("BondInfoDict", {})),
            "charChessEntries": len(season.get("CharChessDataDict", {})),
            "shopCharEntries": len(season.get("CharShopChessDatas", {})),
            "garrisonEffects": len(season.get("GarrisonDataDict", {})),
            "effectInfo": len(season.get("EffectInfoDataDict", {})),
            "effectChoices": len(season.get("EffectChoiceInfoDict", {})),
            "specialEnemies": len(season.get("SpecialEnemyInfoDict", {})),
            "trapChessEntries": len(season.get("TrapChessDataDict", {})),
            "trapShopEntries": len(season.get("TrapShopChessDatas", {})),
            "skillInfoEntries": len(season.get("SkillInfoDataDict", {})),
        },
        "bossHpByMode": boss_hp_by_mode,
        "globalEnemyOverrides": global_enemy_overrides,
        "enemyEffects": enemy_effects,
        "eventEnemyEffects": effect_rows("enemyeffect_", "buffs"),
        "teamChoiceEffects": effect_rows("allybuff_select", "buffs"),
        "specialEnemyPools": special_enemy_pools,
        "specialEnemyRandomTypes": season.get(
            "SpecialEnemyRandomTypeDict", {}
        ),
        "specialEnemyTypeKeys": season.get("EnemyInfoDict", {}),
        "runtimeEnemyRules": {
            "minReplacedEnemyCount": constants.get(
                "MinReplacedEnemyCount"
            ),
            "maxReplacedEnemyCount": constants.get(
                "MaxReplacedEnemyCount"
            ),
            "specialEnemyNum": constants.get("SpecialEnemyNum"),
            "specialEnemyNumSingle": constants.get(
                "SpecialEnemyNumSingle"
            ),
            "enemyTypeIdentifierToFillRandom": constants.get(
                "EnemyTypeIdentifierToFillRandom"
            ),
            "diyCharLimitForLevels": constants.get(
                "DiyCharLimitForLevels",
                season.get("ConstData", {}).get(
                    "DiyCharLimitForLevels", {}
                ),
            ),
            "templateEnemyKeys": {
                key: value
                for key, value in constants.items()
                if key.startswith("TemplateEnemy")
            },
        },
        "gameTips": auto_data.get("GameTipsList", []),
        "effectTypes": auto_data.get("EffectTypeDataDict", {}),
        "skillTriggerRules": auto_data.get("SkillTriggerDataList", []),
        "turnInfoByMode": {
            mode_id: auto_data.get("TurnInfoDataDict", {}).get(mode_id, [])
            for mode_id in MODE_IDS
        },
        "randomEnemyAttributes": random_enemy_attributes,
        "cardPool": card_pool,
        "shopLevels": shop_levels,
        "levels": levels,
    }
    output_dir = args.output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(snapshot, ensure_ascii=False, separators=(",", ":"))
    (output_dir / "autochess-rounds.json").write_text(
        payload, encoding="utf-8"
    )
    (output_dir / "autochess-rounds.js").write_text(
        f"window.ARK_AUTOCHESS_ROUNDS_SNAPSHOT={payload};\n",
        encoding="utf-8",
    )
    print(
        "Wrote "
        f"{len(modes)} modes, "
        f"{sum(mode['roundCount'] for mode in modes.values())} rounds, "
        f"{len(levels)} unique levels"
    )

if __name__ == "__main__":
    main()
