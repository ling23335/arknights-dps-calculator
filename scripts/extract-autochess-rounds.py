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
        actions = []
        for wave_index in range(root.WavesLength()):
            wave = root.Waves(wave_index)
            for fragment_index in range(wave.FragmentsLength()):
                fragment = wave.Fragments(fragment_index)
                for action_index in range(fragment.ActionsLength()):
                    action = fragment.Actions(action_index)
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
                    base_hp = enemy_level_zero_hp(enemy_db, enemy_id)
                    if base_hp is None:
                        missing_hp.add(enemy_id)
                    boss_id = boss_id_by_enemy.get(enemy_id)
                    actions.append(
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
        "bossHpByMode": boss_hp_by_mode,
        "enemyEffects": enemy_effects,
        "randomEnemyAttributes": random_enemy_attributes,
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
