const pickupItems = require('../inventory/pickupItems')
const { goals } = require('mineflayer-pathfinder')

const PASSIVE_ANIMALS = new Set([
  'chicken',
  'cow',
  'mooshroom',
  'pig',
  'rabbit',
  'sheep'
])

const ANIMAL_ALIASES = new Map([
  ['chickens', 'chicken'],
  ['cows', 'cow'],
  ['mooshrooms', 'mooshroom'],
  ['pigs', 'pig'],
  ['rabbits', 'rabbit'],
  ['sheeps', 'sheep']
])

function normalizeAnimalName(value) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^minecraft:/, '')
    .replace(/\s+/g, '_')
  return ANIMAL_ALIASES.get(normalized) || normalized
}

function isPassiveAnimal(value) {
  return PASSIVE_ANIMALS.has(normalizeAnimalName(value))
}

function inventorySnapshot(bot) {
  const counts = new Map()
  for (const item of bot.inventory.items()) {
    counts.set(item.name, (counts.get(item.name) || 0) + item.count)
  }
  return counts
}

function inventoryGain(before, after) {
  const gained = {}
  for (const [name, count] of after) {
    const difference = count - (before.get(name) || 0)
    if (difference > 0) gained[name] = difference
  }
  return gained
}

function attackAndConfirm(bot, target, signal, timeoutMs = 45000) {
  return new Promise((resolve, reject) => {
    let stoppedTimer = null
    const timeout = setTimeout(() => finish('timeout'), timeoutMs)

    const cleanup = () => {
      clearTimeout(timeout)
      if (stoppedTimer) clearTimeout(stoppedTimer)
      bot.removeListener('entityGone', onEntityGone)
      bot.removeListener('stoppedAttacking', onStopped)
      if (signal) signal.removeEventListener('abort', onAbort)
    }

    const finish = (reason) => {
      cleanup()
      resolve(reason)
    }

    const onEntityGone = (entity) => {
      if (entity === target || (entity && entity.id === target.id)) finish('gone')
    }
    const onStopped = () => {
      // Mineflayer-PvP can announce that it stopped just before the server
      // removes a killed entity. Give entityGone a short confirmation window.
      if (!stoppedTimer) stoppedTimer = setTimeout(() => finish('stopped'), 1000)
    }
    const onAbort = () => {
      cleanup()
      reject(signal.reason || new Error('Animal hunt was cancelled.'))
    }

    bot.on('entityGone', onEntityGone)
    bot.on('stoppedAttacking', onStopped)
    if (signal) signal.addEventListener('abort', onAbort, { once: true })

    Promise.resolve().then(() => bot.pvp.attack(target)).catch((error) => {
      cleanup()
      reject(error)
    })
  })
}

function findTarget(bot, animal, maxDistance, excludedIds) {
  return Object.values(bot.entities || {})
    .filter((entity) => (
      entity &&
      entity !== bot.entity &&
      entity.position &&
      entity.name === animal &&
      !entity.customName &&
      !excludedIds.has(entity.id) &&
      bot.entity.position.distanceTo(entity.position) <= maxDistance
    ))
    .sort((a, b) => (
      bot.entity.position.distanceTo(a.position) -
      bot.entity.position.distanceTo(b.position)
    ))[0] || null
}

async function huntAnimals(bot, animalName, amount = 1, options = {}) {
  const animal = normalizeAnimalName(animalName)
  const maxDistance = options.maxDistance || 16
  const signal = options.signal

  if (!PASSIVE_ANIMALS.has(animal)) {
    return {
      status: 'failed',
      animal,
      requested: amount,
      hunted: 0,
      acquired: {},
      message: `${animalName} is not an approved passive animal target.`
    }
  }

  if (!bot.entity || !bot.entity.position) {
    throw new Error('Earl has not spawned and cannot hunt animals.')
  }

  const before = inventorySnapshot(bot)
  const start = bot.entity.position.clone
    ? bot.entity.position.clone()
    : { ...bot.entity.position }
  const excludedIds = new Set()
  let hunted = 0
  let pickupTargets = 0
  let failure = null

  while (hunted < amount) {
    if (signal && signal.aborted) throw signal.reason
    const target = findTarget(bot, animal, maxDistance, excludedIds)
    if (!target) break
    excludedIds.add(target.id)

    if (bot.pvp.target) bot.pvp.forceStop()
    try {
      const reason = await attackAndConfirm(bot, target, signal)
      if (reason !== 'gone') {
        failure = `Attack on ${animal} ended without server kill confirmation.`
        break
      }
      hunted += 1
      if (typeof bot.waitForTicks === 'function') await bot.waitForTicks(8)
      try {
        const pickup = await pickupItems(bot, {
          signal,
          maxDistance: Math.max(maxDistance, 8),
          maxItems: 16
        })
        pickupTargets += pickup.targets
      } catch (error) {
        // A pathfinder stop after a confirmed kill must not erase that verified
        // outcome. Inventory evidence below remains authoritative.
        failure = `Kill confirmed; drop collection was interrupted: ${error.message}`
      }
    } finally {
      if (bot.pvp) bot.pvp.forceStop()
      if (typeof bot.clearControlStates === 'function') bot.clearControlStates()
    }
  }

  try {
    if (bot.pathfinder && typeof bot.pathfinder.goto === 'function') {
      await bot.pathfinder.goto(new goals.GoalNear(start.x, start.y, start.z, 2))
    }
  } catch (error) {
    failure = `${failure ? `${failure} ` : ''}Could not return to the hunt start: ${error.message}`
  }

  const acquired = inventoryGain(before, inventorySnapshot(bot))
  const collectedResources = Object.keys(acquired).length > 0
  const status = hunted === amount && collectedResources
    ? 'completed'
    : hunted > 0
      ? 'partial'
      : 'failed'
  const message = failure || (
    hunted === amount && collectedResources
      ? `Hunted ${hunted} ${animal}${hunted === 1 ? '' : 's'} and collected nearby drops.`
      : hunted === amount
        ? `Confirmed ${hunted} ${animal}${hunted === 1 ? '' : 's'} killed, but no drops entered inventory.`
      : `Found only ${hunted} huntable ${animal}${hunted === 1 ? '' : 's'} within ${maxDistance} blocks.`
  )

  if (typeof bot.chat === 'function') bot.chat(message)
  return {
    status,
    animal,
    requested: amount,
    hunted,
    pickupTargets,
    acquired,
    message
  }
}

module.exports = huntAnimals
module.exports.PASSIVE_ANIMALS = PASSIVE_ANIMALS
module.exports.isPassiveAnimal = isPassiveAnimal
module.exports.normalizeAnimalName = normalizeAnimalName
module.exports.findTarget = findTarget
module.exports.attackAndConfirm = attackAndConfirm
