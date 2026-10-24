# SRD-2024 raw source data

These JSON files are the unmodified Django-fixture exports from the
[open5e-api](https://github.com/open5e/open5e-api) project, taken from
`data/v2/wizards-of-the-coast/srd-2024` on the `staging` branch. They are the input to
`scripts/build-srd2024.mjs`, which converts them into the bundled standard library at
`src/seed/srd2024.data.json`.

Content is the System Reference Document 5.2 material, © Wizards of the Coast, released under the
SRD. open5e-api is MIT-licensed. Content was reorganised (not rewritten) for use in DM Workbench.

## Files used by the converter

| File | Becomes |
| --- | --- |
| `Creature.json` | creature entities (stat blocks) |
| `CreatureAction.json` | each creature's actions / bonus actions / reactions / legendary / lair |
| `CreatureTrait.json` | each creature's traits, legendary-resistance count |
| `Item.json` | mundane item entities |
| `MagicItem.json` | magic item entities (flagged `magical`) |
| `Weapon.json` | damage/range detail merged into weapon items |
| `Armor.json` | AC detail merged into armor items |

(`WeaponProperty.json` and other files in the upstream folder are not consumed yet.)

## Refreshing

```powershell
# re-download (optional), then regenerate the bundled data
npm run srd:build
```

To pull newer upstream data, re-download the files from the URL above into this folder and run
`npm run srd:build` again. The converter assigns deterministic, kind-namespaced ids
(`srd::creature::<pk>`, `srd::item::<pk>`), so re-seeding updates existing standard records in place
without affecting any campaign's custom records.
