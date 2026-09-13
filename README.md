# Earl
Earl is a self-hosted autonomous Minecraft NPC project built with Mineflayer and local AI.
The goal is to create persistent Minecraft companions that can survive, gather resources, craft, farm, fight, build, explore, remember players, and make high-level decisions autonomously.

## Current Status
- Minecraft Java server running
- Mineflayer installed
- Earl can connect successfully
- Players can join and interact with Earl via chat

## Architecture
AI / Goals → Deterministic Skills → Mineflayer → Minecraft

## Commands
- `earl follow me` — Follows you.
- `earl stop` — Stops movement or combat.
- `earl goto <x> <y> <z>` — Travels to the coordinates.
- `earl look at me` — Looks toward you.
- `earl find <block>` — Finds the nearest specified block.
- `earl scan` — Lists nearby entities in the console.
- `earl status` — Shows health, food, position, and status in the console.
- `earl inventory` — Lists inventory in the console.
- `earl gather <block> <amount>` — Mines and collects blocks.
- `earl craft <item> <amount>` — Crafts items, using a nearby table when required.
- `earl store <item> <amount>` — Stores items in a nearby container.
- `earl take <item> <amount>` — Withdraws items from a nearby container.
- `earl equip <item>` — Equips or holds an item.
- `earl attack <hostile>` — Attacks the nearest specified hostile mob.
- `earl task` — Shows Earl's current task in the console.
- `earl place <block> [x, y, z]` — Places a block (optionally at the specified coordinates).
- `earl build line <block> <x> <y> <z> <direction> <length>` — Builds a line of blocks.
- `earl build wall <block> <x> <y> <z> <direction> <width> <height>` — Builds a wall.
- `earl build floor <block> <x> <y> <z> <width> <depth>` — Builds a floor.

### Keywords
`then` — Allows for the chaining of commands. Only the first command must start with `earl`; each command after that only needs the command itself. For example, `earl attack creeper then follow me`

Each command is added to a queue and executed in sequence. For things like gathering, that command in the queue will be skipped if it's impossible to perform (e.g. asking Earl to gather stone without having a pickaxe)


`repeat` — Repeats an entire queue of commands, forever, until stopped. 

Example: `earl goto 273 64 368 then gather stone 4 then goto 236 64 381 then store cobblestone 4 then repeat`