const { goals } = require('mineflayer-pathfinder')
const DoorOpener = require('./DoorOpener')
const {
  configureSafeMovements,
  ensureDoorOpener
} = require('./configureDoorTraversal')

const FACING_OFFSETS = {
  north: [0, -1],
  south: [0, 1],
  east: [1, 0],
  west: [-1, 0]
}

function distance(left, right) {
  return Math.sqrt(
    ((left.x - right.x) ** 2) +
    ((left.y - right.y) ** 2) +
    ((left.z - right.z) ** 2)
  )
}

function doorSides(block) {
  const properties = DoorOpener.blockProperties(block)
  const [x, z] = FACING_OFFSETS[properties.facing] || FACING_OFFSETS.north
  return [
    block.position.offset(x, 0, z),
    block.position.offset(-x, 0, -z)
  ]
}

function findNearbyDoor(bot, maxDistance) {
  const ids = Object.values(bot.registry.blocksByName || {})
    .filter((block) => DoorOpener.isHandOperable({
      name: block.name,
      getProperties: () => ({ open: false })
    }))
    .map((block) => block.id)
  if (ids.length === 0) return null

  const positions = bot.findBlocks({
    matching: ids,
    maxDistance,
    count: 64
  })
  const doors = new Map()

  for (const position of positions) {
    const found = bot.blockAt(position)
    if (!DoorOpener.isHandOperable(found)) continue
    const base = DoorOpener.resolveDoorBase(bot, found)
    const key = `${base.position.x},${base.position.y},${base.position.z}`
    doors.set(key, base)
  }

  return [...doors.values()].sort((left, right) => (
    distance(left.position, bot.entity.position) -
    distance(right.position, bot.entity.position)
  ))[0] || null
}

async function walkDirectlyThrough(bot, destination, signal) {
  if (
    typeof bot.setControlState !== 'function' ||
    typeof bot.waitForTicks !== 'function' ||
    typeof bot.lookAt !== 'function'
  ) return false

  const lookTarget = typeof destination.offset === 'function'
    ? destination.offset(0.5, 1, 0.5)
    : { x: destination.x + 0.5, y: destination.y + 1, z: destination.z + 0.5 }
  await bot.lookAt(lookTarget, true)
  bot.setControlState('forward', true)
  try {
    for (let tick = 0; tick < 35; tick += 1) {
      if (signal && signal.aborted) throw signal.reason
      if (distance(bot.entity.position, destination) <= 1.25) return true
      await bot.waitForTicks(1)
    }
  } finally {
    if (typeof bot.clearControlStates === 'function') bot.clearControlStates()
    else bot.setControlState('forward', false)
  }
  return distance(bot.entity.position, destination) <= 1.25
}

async function crossDoor(bot, destination, signal) {
  try {
    await bot.pathfinder.goto(
      new goals.GoalNear(destination.x, destination.y, destination.z, 1)
    )
  } catch (error) {
    const crossed = await walkDirectlyThrough(bot, destination, signal)
    if (!crossed) throw error
  }
  if (distance(bot.entity.position, destination) > 1.25) {
    await walkDirectlyThrough(bot, destination, signal)
  }
}

async function traverseDoor(bot, options = {}) {
  const {
    signal,
    maxDistance = 16,
    closeBehind = false,
    returnThrough = false
  } = options
  if (signal && signal.aborted) throw signal.reason

  const door = findNearbyDoor(bot, maxDistance)
  if (!door) throw new Error('no hand-openable door is nearby')

  configureSafeMovements(bot)
  const opener = ensureDoorOpener(bot)
  const sides = doorSides(door).sort((left, right) => (
    distance(left, bot.entity.position) - distance(right, bot.entity.position)
  ))
  const nearSide = sides[0]
  const farSide = sides[1]

  if (distance(bot.entity.position, nearSide) > 1.5) {
    await bot.pathfinder.goto(
      new goals.GoalNear(nearSide.x, nearSide.y, nearSide.z, 1)
    )
  }
  if (signal && signal.aborted) throw signal.reason

  await opener.setOpen(door, true)
  await crossDoor(bot, farSide, signal)
  if (signal && signal.aborted) throw signal.reason

  const finalDistance = distance(bot.entity.position, farSide)
  if (finalDistance > 1.25) {
    throw new Error(`did not pass through ${door.name}; still ${finalDistance.toFixed(1)} blocks from the far side`)
  }

  if (returnThrough) {
    await opener.setOpen(door, true)
    await crossDoor(bot, nearSide, signal)
    const returnDistance = distance(bot.entity.position, nearSide)
    if (returnDistance > 1.25) {
      throw new Error(
        `entered through ${door.name} but could not exit; ` +
        `still ${returnDistance.toFixed(1)} blocks from the starting side`
      )
    }
  }

  if (closeBehind) await opener.setOpen(door, false)

  return {
    door: door.name,
    position: door.position,
    crossed: true,
    crossings: returnThrough ? 2 : 1,
    closedBehind: closeBehind
  }
}

module.exports = traverseDoor
module.exports.doorSides = doorSides
module.exports.findNearbyDoor = findNearbyDoor
module.exports.walkDirectlyThrough = walkDirectlyThrough
