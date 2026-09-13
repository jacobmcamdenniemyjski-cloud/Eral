# Earl

Earl is a self-hosted autonomous Minecraft NPC built with Mineflayer and local AI.

The goal is to create a persistent Minecraft companion that can survive, gather resources, craft, farm, fight, build, explore, remember players, and make high-level decisions autonomously.

## Current status

- Minecraft Java server running
- Mineflayer installed
- Earl connects successfully
- Players can interact with Earl through chat

## Architecture

AI / Goals → Deterministic Skills → Mineflayer → Minecraft

## Commands

- `earl follow me` — Follows you.
- `earl stop` — Safely cancels the active queue, movement, gathering, or combat.
- `earl goto <x> <y> <z>` — Travels within two blocks of the coordinates.
- `earl look at me` — Looks toward you.
- `earl find <block>` — Finds the nearest specified block.
- `earl scan` — Lists nearby entities in the console.
- `earl status` — Shows health, food, position, and status in the console.
- `earl inventory` — Lists inventory in the console.
- `earl gather <block> <amount>` — Mines and collects up to 64 blocks.
- `earl craft <item> <amount>` — Crafts items, using a nearby table when required.
- `earl make <item> <amount>` — Crafts required intermediate items, then the requested item.
- `earl store <item> <amount>` — Stores items in a nearby container.
- `earl take <item> <amount>` — Withdraws items from a nearby container.
- `earl equip <item>` — Equips or holds an item.
- `earl attack <hostile>` — Attacks the nearest specified hostile mob.
- `earl combat <mode>` — Sets automatic combat to `passive`, `defensive`, `guard`, or `aggressive`.
- `earl combat status` — Shows the automatic combat mode and protected player.
- `earl task` — Shows Earl's current task in the console.
- `earl place <block> [x y z]` — Places a block, optionally at exact coordinates.
- `earl build line <block> <x> <y> <z> <direction> <length>` — Builds a line.
- `earl build wall <block> <x> <y> <z> <direction> <width> <height>` — Builds a wall.
- `earl build floor <block> <x> <y> <z> <width> <depth>` — Builds a floor.
- `earl skills` — Lists Earl's structured skills in the console.

## Structured skill registry

Earl's chat commands and future AI planner share the same 22 deterministic
skills. Each skill has a stable name, description, JSON input schema, timeout,
and safety category. Inputs are validated with Ajv before Minecraft code runs,
and every execution returns a structured success or error result.

The registry is available at `bot.earl.skillRegistry`. A future model provider
can read `getToolDefinitions()` and request a skill by name; the model will not
generate or execute arbitrary JavaScript. Existing Mineflayer capabilities
remain the implementation underneath the registry.

Example internal call:

```js
const result = await bot.earl.skillRegistry.execute(
  'gather_block',
  { block: 'oak_log', amount: 8 },
  { cancelActiveWork }
)
```

Batch 10 adds the safe skill boundary only. It does not send chat to an LLM or
require an AI API key yet.

## Command queues

Use `then` to execute commands sequentially. Only the first command starts with `earl`:

```text
earl gather dirt 5 then store dirt 5 then follow me
```

Add `repeat` or `then repeat` at the end to safely repeat the queue until `earl stop` is entered:

```text
earl goto 273 64 368 then gather stone 4 then goto 236 64 381 then store cobblestone 4 then repeat
```

Repeating queues pause between iterations so chat and stop commands remain responsive. If an action times out, Earl cancels the underlying Minecraft work and stops that queue rather than starting conflicting actions.

## Automatic combat

Earl starts in `defensive` mode. He automatically defends himself or the latest player who commanded him, equips his best available sword or axe, and interrupts ordinary work only when a threat is close enough.

- `passive` — Never starts combat automatically.
- `defensive` — Responds to damage and hostiles within four blocks.
- `guard` — Protects Earl and his player within eight blocks.
- `aggressive` — Hunts supported hostile mobs within sixteen blocks.

Earl will not begin reflex combat at eight health or lower. `earl stop` immediately ends combat and suppresses the reflex for ten seconds so it cannot restart at once. Endermen and zombified piglins are ignored unless Earl or his protected player is hurt, except in aggressive mode.

The reflex also waits two seconds before retrying the same entity. This prevents repeated combat starts and chat/log spam while still allowing Earl to retry an unfinished fight.

## Friendly item and block names

Item commands accept amounts before or after the name, spaces instead of underscores, and common plural forms. These are equivalent:

```text
earl gather birch_log 64
earl gather 64 birch_logs
earl gather 64 birch logs
```

Placement also accepts an optional `nearby` word:

```text
earl place crafting_table
earl place crafting table nearby
```

The friendlier parsing applies to `gather`, `craft`, `store`, `take`, `equip`, and `place`. Exact Minecraft names remain the most reliable option.

## Multi-step crafting

`craft` performs one recipe with ingredients Earl already has. `make` creates craftable intermediate ingredients first. For example, with two logs and a crafting table nearby:

```text
earl make wooden pickaxe 1
```

Earl can turn logs into planks, planks into sticks, and then craft the pickaxe. He reports the missing raw material if the plan cannot be completed. Batch 9 plans crafting only: it does not automatically gather missing raw materials or place a crafting table yet.

## Development

Install dependencies and run the automated tests:

```cmd
npm install
npm test
```

See [CONTRIBUTING.md](CONTRIBUTING.md) before changing `main`.
