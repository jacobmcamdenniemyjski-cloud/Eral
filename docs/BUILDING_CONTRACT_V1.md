# Building Contract V1

Building Contract V1 gives Hermes design freedom while Earl enforces the basic
requirements that make a Minecraft shelter usable. It is a construction
procedure, not a prebuilt house template.

## Required order

1. Survey the site and select a single finished floor elevation.
2. Validate the footprint and door position with `validate_build_plan`.
3. Clear the footprint plus a two-block margin with `clear_build_site`.
4. Correct any raised blocks or unsupported floor cells reported by site prep.
5. Build the entire floor.
6. Build walls and roof with at least two blocks of interior headroom; three is
   preferred.
7. Install windows and then a two-block door on the planned floor-aligned
   threshold.
8. Add storage, a crafting table, furnace, and lighting.
9. Run `inspect_shelter`, repair every reported problem, and inspect again.
10. Use `traverse_nearby_door` with `returnThrough: true` to prove Earl can
    enter and exit.

## Plan coordinates

`origin` is the northwest corner of the finished floor layer. The door position
is the lower half of the door and must use `origin.y + 1`.

```json
{
  "origin": { "x": 100, "y": 64, "z": 200 },
  "width": 7,
  "depth": 7,
  "interiorHeight": 3,
  "doorPosition": { "x": 103, "y": 65, "z": 200 }
}
```

The doorway must be on a perimeter wall, not a corner. Its inside and outside
approach cells must each have two blocks of clearance.

## Required finished features

- Complete solid floor
- Complete walls with intentional window materials
- A complete wooden or copper door
- Chest, trapped chest, or barrel
- Crafting table
- Furnace, blast furnace, or smoker
- Interior light source and target block light of at least 8
- A physically traversable entrance

Glass blocks, glass panes, fences, and iron bars count as intentional window
materials. Open air does not count as a window.

## Site preparation

`clear_build_site` directly breaks and confirms short grass, ferns, flowers,
two-block flowers, bushes, petals, and similar small vegetation. It does not
silently mine solid terrain. Instead, it reports raised obstructions and holes
so Hermes can choose a safer site or make an explicit, reviewable leveling plan.

Placement primitives also clear a plant occupying their exact target before
placing a block. This is a final safeguard; it does not replace full site prep.

## Door behavior

Normal travel now allows pathfinder to plan through hand-openable doors without
digging through walls. `traverse_nearby_door` is the stronger acceptance test:
Earl independently activates the door, waits for the server-confirmed open
state, retries once, approaches one side, reaches the opposite side, optionally
returns through it, and can close it after crossing.
