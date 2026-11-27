# Arknights AutoChess reverse-engineering log

## 2026-11-27: raw-data coverage audit

### Sources read

- `activity_table071163.json`
  - `Activity.Autochess.act3autochess[0].V3_1`
  - `AutoChessData`
- `enemy_database0e81c0.json`
- `autochess-bundle-output/bfe1215bfd84cb2fc9d29eb17a5a8018`
  - all 91 `level_act3autochess*` FlatBuffers
- `prts___levels.py`, Unity 2021.3.39f1 / IL2CPP metadata v29 schema
- decrypted AutoChess Lua hotfix files under `arknights-reversing/decrypted-lua/AutoChess`
- existing capture notes under `ak-capture/FINDINGS.md`

### Verified table inventory

- 26 mode definitions, 26 `BattleDataDict` mode entries.
- 310 `CharChessDataDict` entries and 155 `CharShopChessDatas` entries.
- 335 `GarrisonDataDict` effects.
- 465 general effect entries, including 40 global enemy modifiers, 129
  bounty/training enemy-add effects and 31 team-choice effects.
- 93 special-enemy pool entries across 9 official special types.
- 116 equipment/trap chess entries and 74 skill/protocol entries.
- 155 shop character prototypes. Visible unique prototype counts by tier:
  19, 24, 26, 27, 31, 26 for tiers 1 through 6.
- The cross-table audit reports zero unresolved references. Two expected
  exceptions are documented: the training mode references removed
  `lateranoShip`, and 12 tier-5/tier-6 DIY slots have no `CharId` until runtime
  selection.

### Level FlatBuffers

- Every action in the 91 AutoChess levels is `SPAWN`; no alternate action
  types occur in these assets.
- 63 levels contain conditional branch data. Branches include `dragon`,
  `acsgnt`, boss summons, escaped-boss paths, split hands and extra routes.
- Branch enemies are conditional and are not added to the deterministic base
  wave total.
- Every level has `EnemyDbRefs`. Seventeen refs carry level-local enemy data.
  Non-zero local values override the corresponding database attributes.
- `level_autochess_enemy_data` contains 16 AutoChess-global enemy overrides.
  Most are attack overrides; `enemy_10163_mnctur_2` also overrides HP to 28,000.
- `root.Enemies` is empty in all 91 levels; the level-local definitions live in
  `EnemyDbRefs.OverwrittenData`.
- There are no level-global buffs in this season's AutoChess levels.
- All levels allow 8 deployed chess units, 150 life points, initial cost 10 and
  max cost 99.
- Level `Options.MaxPlayTime` is 45/55/70/85/95/115/120 seconds depending on
  stage progression. The calculator now uses the selected wave's local battle
  limit for frame simulation and total-damage windows.

### Multiplayer mode rules

- Standard and Danger disable the same 18 `InactiveEnemyKey` entries.
- Hard and Ultimate have no enemy exclusion list.
- Runtime enemy rules:
  - `MinReplacedEnemyCount = 1`
  - `MaxReplacedEnemyCount = 5`
  - `SpecialEnemyNum = 3`
  - `SpecialEnemyNumSingle = 2`
- Template enemy keys are exposed by `ConstData`; exact replacements depend on
  runtime state. Replacement probability or effectiveness factor must not be
  multiplied directly into the base wave HP.

### Trait data

- `CharChessDataDict.GarrisonIds` links character-specific traits to
  `GarrisonDataDict`.
- Garrison effects split into battle effects and preparation/economy effects.
- The calculator now retains the raw Garrison rows and Blackboards and exposes
  them in each selected operator's trait details.

### Code/hotfix evidence

- AutoChess uses separate map layers per player group when multibattle is
  enabled (`AutoChessLevelEnemyManagerHotfixer`).
- Boss step mode tracks enemies and summoned enemies per player group
  (`AutoChessStepModeManagerHotfixer`).
- Boss right-side areas alias the left-side player mapping in the hotfix.
- Existing capture notes do not contain direct proof of a shared runtime card
  pool. The table only proves a per-player field named `playerChessPool`; it
  must not be presented as a controlled multiplayer test result.

### Remaining unknowns

- Branch trigger conditions are native battle logic; branch IDs and spawn
  actions are decoded, but their exact activation conditions are not.
- Exact random-replacement composition requires a runtime trace or controlled
  experiment.
- TVMP-protected IL2CPP metadata registration prevents a complete code dump
  with the current Cpp2IL/Il2CppDumper setup (`MetadataRegistration = 0`).
- Shared-pool behavior still requires a controlled two-account experiment or
  a runtime object trace.

### Calculator integration

- Mode-specific inactive enemies are removed from the enemy selector.
- Level-local and AutoChess-global enemy overrides are applied before mode
  multipliers.
- Conditional branch counts are shown separately from deterministic wave HP.
- Runtime replacement budgets and special-enemy quotas are disclosed.
- Selected-level `MaxPlayTime` drives the frame simulation horizon.
- Raw source data is exposed in the page, and no uncertain runtime replacement
  is silently added to base throughput.
