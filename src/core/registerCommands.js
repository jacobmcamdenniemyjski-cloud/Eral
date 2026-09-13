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
const storeItem = require('../inventory/storeItem')
const takeItem = require('../inventory/takeItem')
const equipItem = require('../inventory/equipItem')
const { placeBlock } = require('../building/placeBlock')
const buildLine = require('../building/buildLine')
const buildWall = require('../building/buildWall')
const buildFloor = require('../building/buildFloor')

const withTimeout = require('../scheduler/withTimeout')

function getPositiveInteger(value, fallback = 1) {
  const number = Number(value)

  if (!Number.isInteger(number) || number <= 0) {
    return fallback
  }

  return number
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

/**
 * @param {import('mineflayer').Bot} bot
 * @param {import('../path/to/scheduler')} scheduler
 * @param {import('../path/to/router')} router
 */
function registerCommands(bot, scheduler, router) {
  bot.on('stoppedAttacking', () => {
    const currentTask = scheduler.getCurrentTask()
    if (currentTask && currentTask.type === 'attack') {
      scheduler.clearTask()
    }
  })

  // used to invalidate an in-progress queue if "earl stop" fires
  let queueGeneration = 0

  const STEP_TIMEOUT_MS = 15000
  const GOTO_TIMEOUT_MS = 3600000 // 1 hour; if Earl is traveling longer than that... why?
  const ARRIVAL_TOLERANCE = 2 // blocks; how close counts as "arrived"

  async function handleGather(args, ctx) {
    const parts = args.split(/\s+/)
    const blockName = parts[0]
    const amount = getPositiveInteger(parts[1], 1)
    if (!blockName) return bot.chat('Usage: gather <block> <amount>')
    await gatherBlock(bot, blockName, amount)
  }

  async function handleCraft(args, ctx) {
    const parts = args.split(/\s+/)
    const itemName = parts[0]
    const amount = getPositiveInteger(parts[1], 1)
    if (!itemName) return bot.chat('Usage: craft <item> <amount>')
    await craftItem(bot, itemName, amount)
  }

  async function handleStore(args, ctx) {
    const parts = args.split(/\s+/)
    const itemName = parts[0]
    const amount = getPositiveInteger(parts[1], 1)
    if (!itemName) return bot.chat('Usage: store <item> <amount>')
    await storeItem(bot, itemName, amount)
  }

  async function handleTake(args, ctx) {
    const parts = args.split(/\s+/)
    const itemName = parts[0]
    const amount = getPositiveInteger(parts[1], 1)
    if (!itemName) return bot.chat('Usage: take <item> <amount>')
    await takeItem(bot, itemName, amount)
  }

  async function handleEquip(args, ctx) {
    const itemName = args.trim()
    if (!itemName) return bot.chat('Usage: equip <item>')
    await equipItem(bot, itemName)
  }

  async function handlePlace(args, ctx) {
    const parts = args.split(/\s+/)
    const blockName = parts[0]
    if (!blockName) return bot.chat('Usage: place <block> [x y z]')

    const hasCoords = parts.length > 1
    const position = hasCoords ? getBuildOrigin(parts, 1) : null
    if (hasCoords && !position) return bot.chat('Usage: place <block> [x y z]')

    try {
      const result = await placeBlock(bot, blockName, position)
      bot.chat(result.skipped ? `${blockName} is already at that position.` : `Placed ${blockName}.`)
    } catch (error) {
      console.error(`Placement failed: ${error.message}`)
      bot.chat(`I could not place ${blockName}: ${error.message}`)
    }
  }

  async function handleBuildLine(args, ctx) {
    const parts = args.split(/\s+/)
    const blockName = parts[0]
    const origin = getBuildOrigin(parts, 1)
    const direction = parts[4] && parts[4].toLowerCase()
    const length = Number(parts[5])

    if (!blockName || !origin || !direction || !Number.isInteger(length)) {
      return bot.chat('Usage: build line <block> <x> <y> <z> <direction> <length>')
    }
    await buildLine(bot, blockName, origin, direction, length)
  }

  async function handleBuildWall(args, ctx) {
    const parts = args.split(/\s+/)
    const blockName = parts[0]
    const origin = getBuildOrigin(parts, 1)
    const direction = parts[4] && parts[4].toLowerCase()
    const width = Number(parts[5])
    const height = Number(parts[6])

    if (!blockName || !origin || !direction || !Number.isInteger(width) || !Number.isInteger(height)) {
      return bot.chat('Usage: build wall <block> <x> <y> <z> <direction> <width> <height>')
    }
    await buildWall(bot, blockName, origin, direction, width, height)
  }

  async function handleBuildFloor(args, ctx) {
    const parts = args.split(/\s+/)
    const blockName = parts[0]
    const origin = getBuildOrigin(parts, 1)
    const width = Number(parts[4])
    const depth = Number(parts[5])

    if (!blockName || !origin || !Number.isInteger(width) || !Number.isInteger(depth)) {
      return bot.chat('Usage: build floor <block> <x> <y> <z> <width> <depth>')
    }
    await buildFloor(bot, blockName, origin, width, depth)
  }

  async function handleGoto(args, ctx) {
    const parts = args.split(/\s+/)
    const [x, y, z] = parts.map(Number)
    if (![x, y, z].every(Number.isFinite)) return bot.chat('Usage: goto <x> <y> <z>')

    const accepted = scheduler.setTask({ type: 'goto', x, y, z, priority: 200 })
    if (!accepted) return

    await withTimeout(goTo(bot, x, y, z), GOTO_TIMEOUT_MS, 'goto')

    const distance = bot.entity.position.distanceTo({ x, y, z })
    if (distance > ARRIVAL_TOLERANCE) {
      throw new Error(`did not reach (${x}, ${y}, ${z}) — still ${distance.toFixed(1)} blocks away`)
    }
  }

  async function handleAttack(args, ctx) {
    const mobName = args.trim().toLowerCase()
    if (!mobName) return bot.chat('Usage: attack <hostile_mob>')

    const accepted = scheduler.setTask({ type: 'attack', target: mobName, priority: 300 })
    if (!accepted) return bot.chat('I am already handling a higher-priority task.')

    try {
      await attackNearestHostile(bot, mobName)
    } finally {
      const currentTask = scheduler.getCurrentTask()
      if (currentTask && currentTask.type === 'attack' && currentTask.target === mobName) {
        scheduler.clearTask()
      }
    }
  }

  async function handleFollowMe(args, ctx) {
    const accepted = scheduler.setTask({ type: 'follow', target: ctx.username, priority: 200 })
    if (accepted) await followPlayer(bot, ctx.username)
  }

  async function handleLookAtMe(args, ctx) {
    await lookAtPlayer(bot, ctx.username)
  }

  async function handleFind(args) {
    const blockName = args.trim()
    if (!blockName) return bot.chat('Usage: find <block>')
    const block = findNearestBlock(bot, blockName)
    console.log(block ? { name: block.name, position: block.position } : `No ${blockName} found nearby.`)
  }

  async function handleStop() {
    queueGeneration++ // invalidate any queue currently running
    scheduler.clearTask()
    if (bot.pvp) bot.pvp.forceStop()
    stopMovement(bot)
  }

  async function handleStatus() { console.log(getStatus(bot)) }
  async function handleScan() { console.log(getNearbyEntities(bot)) }
  async function handleInventory() { console.log(getInventory(bot)) }
  async function handleTask() { console.log(scheduler.getCurrentTask()) }

  const verbTable = [
    ['build line', handleBuildLine],
    ['build wall', handleBuildWall],
    ['build floor', handleBuildFloor],
    ['follow me', handleFollowMe],
    ['look at me', handleLookAtMe],
    ['gather', handleGather],
    ['craft', handleCraft],
    ['store', handleStore],
    ['take', handleTake],
    ['equip', handleEquip],
    ['place', handlePlace],
    ['goto', handleGoto],
    ['attack', handleAttack],
    ['stop', handleStop],
    ['find', handleFind],
    ['status', handleStatus],
    ['scan', handleScan],
    ['inventory', handleInventory],
    ['task', handleTask]
  ]

  function matchVerb(segment) {
    for (const [verb, handler] of verbTable) {
      if (segment === verb || segment.startsWith(verb + ' ')) {
        return { handler, args: segment.slice(verb.length).trim() }
      }
    }
    return null
  }

  async function runQueue(fullText, ctx) {
    queueGeneration += 1
    const myGeneration = queueGeneration

    const rawSegments = fullText.split(/\s+then\s+/i).map(s => s.trim()).filter(Boolean)
    if (rawSegments.length === 0) {
      bot.chat("yo")
      return
    }

    let repeatForever = false
    let segments = rawSegments

    if (rawSegments[rawSegments.length - 1].toLowerCase() === 'repeat') {
      repeatForever = true
      segments = rawSegments.slice(0, -1)
    }

    if (segments.length === 0) {
      bot.chat('Nothing to repeat.')
      return
    }

    let iteration = 0

    do {
      iteration += 1
      if (repeatForever) console.log(`[queue] starting iteration ${iteration}`)

      for (const segment of segments) {
        if (queueGeneration !== myGeneration) {
          bot.chat('Queue cancelled.')
          return
        }

        const match = matchVerb(segment)
        if (!match) {
          bot.chat(`I don't know how to "${segment}", skipping.`)
          continue
        }

        const timeoutMs = match.handler === handleGoto ? GOTO_TIMEOUT_MS : STEP_TIMEOUT_MS

        console.log(`[queue] starting: ${segment}`)

        try {
          await withTimeout(match.handler(match.args, ctx), timeoutMs, segment)
          console.log(`[queue] finished: ${segment}`)
        } catch (error) {
          console.error(`[queue] step failed: "${segment}" — ${error.message}`)
          bot.chat(`Couldn't finish "${segment}": ${error.message}. Moving on.`)
        }
      }
    } while (repeatForever && queueGeneration === myGeneration)
  }

  router.prefix('earl', async ({ args, username }) => {
    await runQueue(args.trim(), { username })
  })
}

module.exports = registerCommands