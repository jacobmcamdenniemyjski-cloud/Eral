const followPlayer = require('../movement/followPlayer')
const stopMovement = require('../movement/stopMovement')
const goTo = require('../movement/goTo')
const lookAtPlayer = require('../movement/lookAtPlayer')

const findNearestBlock = require('../perception/findNearestBlock')
const getStatus = require('../perception/getStatus')
const getNearbyEntities = require('../perception/getNearbyEntities')
const getInventory = require('../perception/getInventory')

const gatherBlock = require('../gathering/gatherBlock')
const craftItem = require('../crafting/craftItem')
const attackNearestHostile = require('../combat/attackNearestHostile')
const CombatReflex = require('../combat/CombatReflex')
const storeItem = require('../inventory/storeItem')
const takeItem = require('../inventory/takeItem')
const equipItem = require('../inventory/equipItem')
const { placeBlock } = require('../building/placeBlock')
const buildLine = require('../building/buildLine')
const buildWall = require('../building/buildWall')
const buildFloor = require('../building/buildFloor')
const CommandQueue = require('../scheduler/CommandQueue')
const {
  parseItemRequest,
  resolveResourceName
} = require('./parseItemRequest')

const TIMEOUTS = {
  quick: 30000,
  place: 60000,
  inventoryAction: 120000,
  craft: 120000,
  attack: 120000,
  line: 180000,
  wall: 300000,
  floor: 600000,
  gather: 600000,
  goto: 600000
}

function getBuildOrigin(parts, startIndex = 1) {
  const coordinates = parts
    .slice(startIndex, startIndex + 3)
    .map(Number)

  if (
    coordinates.length !== 3 ||
    !coordinates.every(Number.isInteger)
  ) {
    return null
  }

  return {
    x: coordinates[0],
    y: coordinates[1],
    z: coordinates[2]
  }
}

function registerCommands(bot, scheduler, router) {
  bot.on('stoppedAttacking', () => {
    const currentTask = scheduler.getCurrentTask()

    if (currentTask && currentTask.type === 'attack') {
      scheduler.clearTask()
    }
  })

  async function cancelActiveWork() {
    if (
      bot.collectBlock &&
      typeof bot.collectBlock.cancelTask === 'function'
    ) {
      try {
        await Promise.race([
          Promise.resolve(bot.collectBlock.cancelTask()),
          new Promise((resolve) => setTimeout(resolve, 1000))
        ])
      } catch (error) {
        console.error(`Collect cancellation failed: ${error.message}`)
      }
    }

    if (bot.pvp && typeof bot.pvp.forceStop === 'function') {
      try {
        bot.pvp.forceStop()
      } catch (error) {
        console.error(`Combat cancellation failed: ${error.message}`)
      }
    }

    if (bot.pathfinder) {
      try {
        bot.pathfinder.setGoal(null)
      } catch (error) {
        console.error(`Movement cancellation failed: ${error.message}`)
      }
    }

    if (typeof bot.clearControlStates === 'function') {
      bot.clearControlStates()
    }

    if (bot.currentWindow && typeof bot.closeWindow === 'function') {
      try {
        await bot.closeWindow(bot.currentWindow)
      } catch (error) {
        console.error(`Window cancellation failed: ${error.message}`)
      }
    }

    scheduler.clearTask()
    await new Promise((resolve) => setImmediate(resolve))
  }

  const commandQueue = new CommandQueue({
    cancelActiveWork,
    repeatDelayMs: 1000,
    maxSegments: 20,
    notify: (message) => bot.chat(message),
    onStart: (label) => console.log(`[queue] starting: ${label}`),
    onFinish: (label) => console.log(`[queue] finished: ${label}`),
    onError: (label, error, timedOut) => {
      console.error(`[queue] step failed: "${label}" — ${error.message}`)

      if (timedOut) {
        bot.chat(`"${label}" took too long and was safely stopped.`)
      } else {
        bot.chat(`Couldn't finish "${label}": ${error.message}. Moving on.`)
      }
    }
  })

  const combatReflex = new CombatReflex(bot, scheduler, {
    mode: 'defensive',
    cancelForThreat: (reason) => commandQueue.cancel(reason),
    notify: (message) => bot.chat(message)
  })
  combatReflex.start()

  function clearTaskIf(type, predicate = () => true) {
    const currentTask = scheduler.getCurrentTask()

    if (currentTask && currentTask.type === type && predicate(currentTask)) {
      scheduler.clearTask()
    }
  }

  async function handleGather(args, context) {
    const request = parseItemRequest(bot, args, { kind: 'block' })

    if (!request) return bot.chat('Usage: gather <block> <amount>')
    if (request.amount > 64) {
      return bot.chat('Gather at most 64 blocks per command.')
    }

    await gatherBlock(bot, request.name, request.amount, {
      signal: context.signal
    })
  }

  async function handleCraft(args, context) {
    const request = parseItemRequest(bot, args, { kind: 'item' })

    if (!request) return bot.chat('Usage: craft <item> <amount>')
    if (context.signal.aborted) throw context.signal.reason

    await craftItem(bot, request.name, request.amount)
  }

  async function handleStore(args, context) {
    const request = parseItemRequest(bot, args, { kind: 'item' })

    if (!request) return bot.chat('Usage: store <item> <amount>')
    if (context.signal.aborted) throw context.signal.reason

    await storeItem(bot, request.name, request.amount)
  }

  async function handleTake(args, context) {
    const request = parseItemRequest(bot, args, { kind: 'item' })

    if (!request) return bot.chat('Usage: take <item> <amount>')
    if (context.signal.aborted) throw context.signal.reason

    await takeItem(bot, request.name, request.amount)
  }

  async function handleEquip(args, context) {
    const request = parseItemRequest(bot, args, {
      kind: 'item',
      allowAmount: false
    })

    if (!request) return bot.chat('Usage: equip <item>')
    if (context.signal.aborted) throw context.signal.reason

    await equipItem(bot, request.name)
  }

  async function handlePlace(args, context) {
    const parts = args.trim().split(/\s+/).filter(Boolean)
    if (
      parts[parts.length - 1] &&
      parts[parts.length - 1].toLowerCase() === 'nearby'
    ) {
      parts.pop()
    }

    let position = null
    const coordinateStart = parts.length - 3
    const coordinateCandidate = coordinateStart > 0
      ? getBuildOrigin(parts, coordinateStart)
      : null

    if (coordinateCandidate) {
      position = coordinateCandidate
      parts.splice(coordinateStart, 3)
    }

    const request = parseItemRequest(bot, parts.join(' '), {
      kind: 'block',
      allowAmount: false
    })

    if (!request) return bot.chat('Usage: place <block> [x y z]')
    const blockName = request.name

    try {
      const result = await placeBlock(bot, blockName, position, {
        signal: context.signal
      })

      bot.chat(
        result.skipped
          ? `${blockName} is already at that position.`
          : `Placed ${blockName}.`
      )
    } catch (error) {
      if (context.signal.aborted) throw error

      console.error(`Placement failed: ${error.message}`)
      bot.chat(`I could not place ${blockName}: ${error.message}`)
    }
  }

  async function handleBuildLine(args, context) {
    const parts = args.split(/\s+/)
    const blockName = resolveResourceName(bot, parts[0], 'block') || parts[0]
    const origin = getBuildOrigin(parts, 1)
    const direction = parts[4] && parts[4].toLowerCase()
    const length = Number(parts[5])

    if (!blockName || !origin || !direction || !Number.isInteger(length)) {
      return bot.chat(
        'Usage: build line <block> <x> <y> <z> <direction> <length>'
      )
    }

    await buildLine(bot, blockName, origin, direction, length, {
      signal: context.signal
    })
  }

  async function handleBuildWall(args, context) {
    const parts = args.split(/\s+/)
    const blockName = resolveResourceName(bot, parts[0], 'block') || parts[0]
    const origin = getBuildOrigin(parts, 1)
    const direction = parts[4] && parts[4].toLowerCase()
    const width = Number(parts[5])
    const height = Number(parts[6])

    if (
      !blockName ||
      !origin ||
      !direction ||
      !Number.isInteger(width) ||
      !Number.isInteger(height)
    ) {
      return bot.chat(
        'Usage: build wall <block> <x> <y> <z> <direction> <width> <height>'
      )
    }

    await buildWall(
      bot,
      blockName,
      origin,
      direction,
      width,
      height,
      { signal: context.signal }
    )
  }

  async function handleBuildFloor(args, context) {
    const parts = args.split(/\s+/)
    const blockName = resolveResourceName(bot, parts[0], 'block') || parts[0]
    const origin = getBuildOrigin(parts, 1)
    const width = Number(parts[4])
    const depth = Number(parts[5])

    if (
      !blockName ||
      !origin ||
      !Number.isInteger(width) ||
      !Number.isInteger(depth)
    ) {
      return bot.chat(
        'Usage: build floor <block> <x> <y> <z> <width> <depth>'
      )
    }

    await buildFloor(bot, blockName, origin, width, depth, {
      signal: context.signal
    })
  }

  async function handleGoto(args, context) {
    const parts = args.split(/\s+/)
    const coordinates = parts.map(Number)

    if (
      coordinates.length !== 3 ||
      !coordinates.every(Number.isFinite)
    ) {
      return bot.chat('Usage: goto <x> <y> <z>')
    }

    const [x, y, z] = coordinates
    const accepted = scheduler.setTask({
      type: 'goto',
      x,
      y,
      z,
      priority: 200
    })

    if (!accepted) {
      return bot.chat('I am already handling a higher-priority task.')
    }

    try {
      await goTo(bot, x, y, z, {
        tolerance: 2,
        signal: context.signal
      })
    } finally {
      clearTaskIf('goto', (task) => (
        task.x === x && task.y === y && task.z === z
      ))
    }
  }

  async function handleAttack(args, context) {
    const mobName = args.trim().toLowerCase()
    if (!mobName) return bot.chat('Usage: attack <hostile_mob>')

    const accepted = scheduler.setTask({
      type: 'attack',
      target: mobName,
      priority: 300
    })

    if (!accepted) {
      return bot.chat('I am already handling a higher-priority task.')
    }

    try {
      await attackNearestHostile(
        bot,
        mobName,
        16,
        { signal: context.signal }
      )
    } finally {
      clearTaskIf('attack', (task) => task.target === mobName)
    }
  }

  async function handleCombat(args, context) {
    const requestedMode = args.trim().toLowerCase()
    combatReflex.protect(context.username)

    if (!requestedMode || requestedMode === 'status') {
      const status = combatReflex.getStatus()
      bot.chat(
        `Combat is ${status.mode}` +
        (status.protecting ? `; protecting ${status.protecting}.` : '.')
      )
      return
    }

    if (!combatReflex.setMode(requestedMode, context.username)) {
      bot.chat('Usage: combat <passive|defensive|guard|aggressive|status>')
      return
    }

    bot.chat(`Combat mode set to ${requestedMode}.`)
  }

  async function handleFollowMe(args, context) {
    const accepted = scheduler.setTask({
      type: 'follow',
      target: context.username,
      priority: 200
    })

    if (accepted) await followPlayer(bot, context.username)
  }

  async function handleLookAtMe(args, context) {
    await lookAtPlayer(bot, context.username)
  }

  async function handleStop(args, context) {
    await context.stopQueue()
  }

  async function handleFind(args) {
    const blockName = args.trim()
    if (!blockName) return bot.chat('Usage: find <block>')

    const block = findNearestBlock(bot, blockName)
    console.log(
      block
        ? { name: block.name, position: block.position }
        : `No ${blockName} found nearby.`
    )
  }

  async function handleStatus() { console.log(getStatus(bot)) }
  async function handleScan() { console.log(getNearbyEntities(bot)) }
  async function handleInventory() { console.log(getInventory(bot)) }
  async function handleTask() { console.log(scheduler.getCurrentTask()) }

  const verbs = [
    { verb: 'build line', handler: handleBuildLine, timeoutMs: TIMEOUTS.line },
    { verb: 'build wall', handler: handleBuildWall, timeoutMs: TIMEOUTS.wall },
    { verb: 'build floor', handler: handleBuildFloor, timeoutMs: TIMEOUTS.floor },
    { verb: 'follow me', handler: handleFollowMe, timeoutMs: TIMEOUTS.quick },
    { verb: 'look at me', handler: handleLookAtMe, timeoutMs: TIMEOUTS.quick },
    { verb: 'gather', handler: handleGather, timeoutMs: TIMEOUTS.gather },
    { verb: 'craft', handler: handleCraft, timeoutMs: TIMEOUTS.craft },
    { verb: 'store', handler: handleStore, timeoutMs: TIMEOUTS.inventoryAction },
    { verb: 'take', handler: handleTake, timeoutMs: TIMEOUTS.inventoryAction },
    { verb: 'equip', handler: handleEquip, timeoutMs: TIMEOUTS.quick },
    { verb: 'place', handler: handlePlace, timeoutMs: TIMEOUTS.place },
    { verb: 'goto', handler: handleGoto, timeoutMs: TIMEOUTS.goto },
    { verb: 'attack', handler: handleAttack, timeoutMs: TIMEOUTS.attack },
    { verb: 'combat', handler: handleCombat, timeoutMs: TIMEOUTS.quick, passive: true },
    { verb: 'stop', handler: handleStop, timeoutMs: TIMEOUTS.quick },
    { verb: 'find', handler: handleFind, timeoutMs: TIMEOUTS.quick, passive: true },
    { verb: 'status', handler: handleStatus, timeoutMs: TIMEOUTS.quick, passive: true },
    { verb: 'scan', handler: handleScan, timeoutMs: TIMEOUTS.quick, passive: true },
    { verb: 'inventory', handler: handleInventory, timeoutMs: TIMEOUTS.quick, passive: true },
    { verb: 'task', handler: handleTask, timeoutMs: TIMEOUTS.quick, passive: true }
  ]

  function matchVerb(segment) {
    const lower = segment.toLowerCase()

    for (const entry of verbs) {
      if (lower === entry.verb || lower.startsWith(`${entry.verb} `)) {
        return {
          ...entry,
          args: segment.slice(entry.verb.length).trim()
        }
      }
    }

    return null
  }

  router.prefix('earl', async ({ args, username }) => {
    const text = args.trim()
    combatReflex.protect(username)
    const singleMatch = !/\s+then\s+|(?:^|\s)repeat\s*$/i.test(text)
      ? matchVerb(text)
      : null

    if (singleMatch && singleMatch.verb === 'stop') {
      combatReflex.suppress(10000)
      await commandQueue.stop('stopped by player')
      stopMovement(bot)
      bot.chat('Stopped.')
      return
    }

    if (singleMatch && singleMatch.passive) {
      await singleMatch.handler(singleMatch.args, {
        username,
        signal: new AbortController().signal
      })
      return
    }

    if (
      !singleMatch &&
      text &&
      !/\s+then\s+|(?:^|\s)repeat\s*$/i.test(text)
    ) {
      bot.chat(`I don't know how to "${text}".`)
      return
    }

    // A direct player command takes control immediately. The short pause keeps
    // the reflex from restarting during queue handoff; a continuing threat can
    // still interrupt the new task one second later.
    combatReflex.suppress(1000)

    await commandQueue.run(
      text,
      {
        username,
        stopQueue: () => commandQueue.stop('stopped by queue command')
      },
      matchVerb
    )
  })
}

module.exports = registerCommands
