from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path


DEFAULT_LEVEL_DIR = Path(
    r"D:\NEWgame\arknights-extracted\autochess-bundle-output"
    r"\bfe1215bfd84cb2fc9d29eb17a5a8018"
)
DEFAULT_ENEMY_DB = Path(
    r"D:\NEWgame\arknights-extracted\hot-decoded"
    r"\605f70adca6554eb8bcb869ccd1418ea\enemy_database0e81c0.json"
)
DEFAULT_FBS_DIR = Path(r"D:\NEWgame\tools\ark-fbs-py\CN")

ACTION_TYPES = {
    0: "SPAWN",
    1: "PREVIEW_CURSOR",
    2: "STORY",
    3: "TUTORIAL",
    4: "PLAY_BGM",
    5: "DISPLAY_ENEMY_INFO",
    6: "ACTIVATE_PREDEFINED",
    7: "PLAY_OPERA",
    8: "TRIGGER_PREDEFINED",
    9: "BATTLE_EVENTS",
    10: "WITHDRAW_PREDEFINED",
    11: "DIALOG",
    12: "SHOW_ALL_HIDDEN_CARDS",
    13: "EMPTY",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Audit all local act3autochess level FlatBuffer fields."
    )
    parser.add_argument("--level-dir", type=Path, default=DEFAULT_LEVEL_DIR)
    parser.add_argument("--enemy-db", type=Path, default=DEFAULT_ENEMY_DB)
    parser.add_argument("--fbs-dir", type=Path, default=DEFAULT_FBS_DIR)
    parser.add_argument("--output", type=Path)
    return parser.parse_args()


def decode(value) -> str | None:
    if not value:
        return None
    if isinstance(value, bytes):
        return value.decode("utf-8")
    if hasattr(value, "MValue"):
        raw = value.MValue()
        return decode(raw) if raw != value else str(raw)
    return str(value)


def scalar(value):
    if value is None:
        return None
    if hasattr(value, "MValue"):
        return scalar(value.MValue())
    return value


def read_blackboard(table) -> dict:
    if not table:
        return {}
    return {
        decode(table.Key(i)): {
            "value": table.Value(i),
            "valueStr": decode(table.ValueStr(i)),
        }
        for i in range(table.Length() if hasattr(table, "Length") else 0)
    }


def read_blackboard_pairs(getter, length: int) -> dict:
    if not getter or not length:
        return {}
    result = {}
    for i in range(length):
        pair = getter(i)
        key = decode(pair.Key())
        result[key] = {
            "value": scalar(pair.Value()),
            "valueStr": decode(pair.ValueStr()),
        }
    return result


def enemy_stats(enemy_data) -> dict:
    attributes = enemy_data.Attributes()
    if not attributes:
        return {}
    return {
        "hp": scalar(attributes.MaxHp()),
        "attack": scalar(attributes.Atk()),
        "defense": scalar(attributes.Def()),
        "resistance": scalar(attributes.MagicResistance()),
        "attackInterval": scalar(attributes.BaseAttackTime()),
        "attackSpeed": scalar(attributes.AttackSpeed()),
        "moveSpeed": scalar(attributes.MoveSpeed()),
        "massLevel": scalar(attributes.MassLevel()),
    }


def database_level_hp(enemy_db: dict, enemy_id: str):
    records = enemy_db.get(enemy_id) or []
    record = next(
        (item for item in records if int(item.get("Level", 0)) == 0),
        records[0] if records else None,
    )
    return (
        record.get("EnemyData", {})
        .get("Attributes", {})
        .get("MaxHp", {})
        .get("MValue")
        if record
        else None
    )


def collect_actions(actions_table, counter: Counter, spawns: list) -> None:
    if not actions_table:
        return
    for index in range(actions_table.ActionsLength()):
        action = actions_table.Actions(index)
        action_type = int(scalar(action.ActionType()))
        action_name = ACTION_TYPES.get(action_type, str(action_type))
        counter[action_name] += 1
        if action_name != "SPAWN":
            continue
        spawns.append(
            {
                "enemyId": decode(action.Key()),
                "count": int(scalar(action.Count())),
                "preDelay": float(scalar(action.PreDelay())),
                "interval": float(scalar(action.Interval())),
                "routeIndex": int(scalar(action.RouteIndex())),
                "randomType": int(scalar(action.RandomType())),
                "refreshType": int(scalar(action.RefreshType())),
                "randomSpawnGroupKey": decode(action.RandomSpawnGroupKey()),
                "randomSpawnGroupPackKey": decode(
                    action.RandomSpawnGroupPackKey()
                ),
                "hiddenGroup": decode(action.HiddenGroup()),
                "weight": int(scalar(action.Weight())),
                "managedByScheduler": bool(scalar(action.ManagedByScheduler())),
                "blockFragment": bool(scalar(action.BlockFragment())),
                "dontBlockWave": bool(scalar(action.DontBlockWave())),
                "forceBlockWaveInBranch": bool(
                    scalar(action.ForceBlockWaveInBranch())
                ),
                "autoDisplayEnemyInfo": bool(
                    scalar(action.AutoDisplayEnemyInfo())
                ),
                "autoPreviewRoute": bool(scalar(action.AutoPreviewRoute())),
                "isUnharmfulAndAlwaysCountAsKilled": bool(
                    scalar(action.IsUnharmfulAndAlwaysCountAsKilled())
                ),
            }
        )


def main() -> None:
    args = parse_args()
    sys.path.insert(0, str(args.fbs_dir))
    import prts___levels as level_fbs  # pylint: disable=import-outside-toplevel

    enemy_db = json.loads(args.enemy_db.read_text(encoding="utf-8")).get(
        "Enemies", {}
    )
    paths = sorted(args.level_dir.glob("level_act3autochess*"))
    if not paths:
        raise FileNotFoundError("No act3autochess level assets found.")

    levels = {}
    total_action_types = Counter()
    for path in paths:
        payload = path.read_bytes()
        root = level_fbs.ROOT_TYPE.GetRootAs(bytearray(payload)[128:], 0)
        inline_enemies = {}
        for index in range(root.EnemiesLength()):
            enemy = root.Enemies(index)
            key = decode(enemy.Key())
            inline_enemies[key] = {
                "name": decode(enemy.Name()),
                "description": decode(enemy.Description()),
                "alias": decode(enemy.Alias()),
                "levelType": int(scalar(enemy.LevelType())),
                "lifePointReduce": int(scalar(enemy.LifePointReduce())),
                "notCountInTotal": bool(scalar(enemy.NotCountInTotal())),
                "stats": enemy_stats(enemy),
                "tags": [
                    decode(enemy.EnemyTags(i))
                    for i in range(enemy.EnemyTagsLength())
                ],
            }

        db_refs = []
        for index in range(root.EnemyDbRefsLength()):
            item = root.EnemyDbRefs(index)
            overwritten = item.OverwrittenData()
            db_refs.append(
                {
                    "id": decode(item.Id()),
                    "level": int(scalar(item.Level())),
                    "useDb": bool(scalar(item.UseDb())),
                    "overwritten": (
                        {
                            "name": decode(overwritten.Name()),
                            "stats": enemy_stats(overwritten),
                        }
                        if overwritten
                        else None
                    ),
                }
            )

        global_buffs = []
        for index in range(root.GlobalBuffsLength()):
            buff = root.GlobalBuffs(index)
            global_buffs.append(
                {
                    "prefabKey": decode(buff.PrefabKey()),
                    "blackboard": read_blackboard_pairs(
                        buff.Blackboard, buff.BlackboardLength()
                    ),
                    "professionMask": int(scalar(buff.ProfessionMask())),
                    "playerSideMask": int(scalar(buff.PlayerSideMask())),
                }
            )

        optional_runes = []
        for index in range(root.OptionalRunesLength()):
            rune = root.OptionalRunes(index)
            optional_runes.append(
                {
                    "key": decode(rune.Key()),
                    "blackboard": read_blackboard_pairs(
                        rune.Blackboard, rune.BlackboardLength()
                    ),
                }
            )

        action_types = Counter()
        spawns = []
        wave_count = 0
        for wave_index in range(root.WavesLength()):
            wave = root.Waves(wave_index)
            wave_count += 1
            for fragment_index in range(wave.FragmentsLength()):
                collect_actions(
                    wave.Fragments(fragment_index),
                    action_types,
                    spawns,
                )

        branches = []
        for branch_index in range(root.BranchesLength()):
            branch_entry = root.Branches(branch_index)
            branch = branch_entry.Value()
            phases = []
            for phase_index in range(branch.PhasesLength()):
                phase = branch.Phases(phase_index)
                branch_action_types = Counter()
                branch_spawns = []
                collect_actions(
                    phase, branch_action_types, branch_spawns
                )
                phases.append(
                    {
                        "preDelay": float(scalar(phase.PreDelay())),
                        "actionTypes": dict(branch_action_types),
                        "spawns": branch_spawns,
                    }
                )
            branches.append(
                {
                    "branchId": decode(branch_entry.Key()),
                    "phases": phases,
                }
            )

        total_action_types.update(action_types)
        spawn_keys = sorted(
            {spawn["enemyId"] for spawn in spawns if spawn["enemyId"]}
        )
        inline_spawn_keys = [
            key for key in spawn_keys if key in inline_enemies
        ]
        hp_deltas = []
        for key in inline_spawn_keys:
            inline_hp = inline_enemies[key]["stats"].get("hp")
            db_hp = database_level_hp(enemy_db, key)
            if inline_hp is not None and db_hp is not None and inline_hp != db_hp:
                hp_deltas.append(
                    {
                        "enemyId": key,
                        "inlineHp": inline_hp,
                        "databaseHp": db_hp,
                        "ratio": round(inline_hp / db_hp, 6) if db_hp else None,
                    }
                )

        options = root.Options()
        config_blackboard = read_blackboard_pairs(
            options.ConfigBlackBoard if options else None,
            options.ConfigBlackBoardLength() if options else 0,
        )
        levels[path.name] = {
            "levelId": decode(root.LevelId()),
            "mapId": decode(root.MapId()),
            "waveCount": wave_count,
            "actionTypes": dict(action_types),
            "spawnCount": sum(spawn["count"] for spawn in spawns),
            "spawnedEnemyKeys": spawn_keys,
            "inlineEnemyCount": len(inline_enemies),
            "inlineSpawnedEnemyCount": len(inline_spawn_keys),
            "inlineHpDeltasVersusDatabaseLevel0": hp_deltas,
            "enemyDbRefCount": len(db_refs),
            "enemyDbRefs": db_refs,
            "globalBuffs": global_buffs,
            "optionalRunes": optional_runes,
            "branchCount": len(branches),
            "branches": branches,
            "options": {
                "characterLimit": int(scalar(options.CharacterLimit())),
                "maxLifePoint": int(scalar(options.MaxLifePoint())),
                "initialCost": int(scalar(options.InitialCost())),
                "maxCost": int(scalar(options.MaxCost())),
                "costIncreaseTime": float(
                    scalar(options.CostIncreaseTime())
                ),
                "moveMultiplier": float(scalar(options.MoveMultiplier())),
                "maxPlayTime": float(scalar(options.MaxPlayTime())),
                "configBlackboard": config_blackboard,
            }
            if options
            else None,
        }

    report = {
        "sources": {
            "levelDir": str(args.level_dir),
            "enemyDatabase": str(args.enemy_db),
            "schema": str(args.fbs_dir / "prts___levels.py"),
        },
        "levelCount": len(levels),
        "actionTypeTotals": dict(total_action_types),
        "levels": levels,
    }
    text = json.dumps(report, ensure_ascii=False, indent=2)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(text, encoding="utf-8")
    print(
        json.dumps(
            {
                "levelCount": report["levelCount"],
                "actionTypeTotals": report["actionTypeTotals"],
                "levelsWithInlineHpDeltas": sum(
                    bool(level["inlineHpDeltasVersusDatabaseLevel0"])
                    for level in levels.values()
                ),
                "levelsWithGlobalBuffs": sum(
                    bool(level["globalBuffs"]) for level in levels.values()
                ),
                "levelsWithBranches": sum(
                    bool(level["branches"]) for level in levels.values()
                ),
                "levelsWithEnemyDbRefs": sum(
                    bool(level["enemyDbRefs"]) for level in levels.values()
                ),
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    if args.output:
        print(f"Wrote {args.output}")


if __name__ == "__main__":
    main()
