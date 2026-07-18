# MVP Construction Vocabulary

> **Roadmap item:** P4.1  
> **Authority:** `src/world/ConstructionVocabulary.js`

## Player-facing model

MetroPulse exposes exactly three development policies:

| Stable ID | Label | Compatible ordinary development |
|---|---|---|
| `RESIDENTIAL` | Residential | Housing |
| `COMMERCIAL` | Commercial | Shops and offices |
| `OPERATIONS` | Operations | Fabrication and logistics |

Power, water, safety, medical, police, parks, and other civic/service assets
are constructed `FACILITIES`. Roads and bridge pieces are constructed
`INFRASTRUCTURE`. Neither group creates a fourth zoning policy.

## Catalog disclosure

The default Operator catalog contains six assets: CyberCafe, Metro Lofts,
Cyber-Fabrication Works, a road segment, an energy array, and Fire & Rescue.
Together they give the player one build choice for every development zone plus
the access, energy, and safety vocabulary needed for the next city decision.

`Show advanced` is an explicit optional filter. Advanced Operator assets are
available immediately after disclosure; Broker and Magnate assets remain
visible but locked with their required capability tier. Access is checked in
`CityEditorSystem` as well as the DOM, so UI manipulation cannot bypass it.

## Compatibility and persistence

- Input aliases `IND` and `INDUSTRIAL` normalize to `OPERATIONS`.
- Input alias `OFFICE` normalizes to `COMMERCIAL`.
- Save schema 2 migrates both world parcels and economy zone effects before
  content-reference validation.
- Migration retains parcel keys, coordinates, happiness, and land-value
  modifiers; it changes only the vocabulary ID.
- Legacy power, water, and fire parcel definitions remain load-only
  compatibility records. No current UI or zoning command can create them.
- Building saves use stable spec IDs, so moving catalog entries from the old
  Civic/Utilities/Industrial tabs into Facilities/Operations needs no building
  migration.

## Extension rules

Add new assets through `BuildingCatalog` with a construction category,
disclosure stage, and progression tier. Do not add a new zone for a service or
asset class. A fourth development zone requires a GDD amendment, scope update,
save migration, compatibility rules, and acceptance coverage in the same
change.
