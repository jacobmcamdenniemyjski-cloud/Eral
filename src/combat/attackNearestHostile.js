const HOSTILE_MOBS = new Set([
  'blaze', 'bogged', 'breeze', 'cave_spider', 'creeper', 'drowned',
  'elder_guardian', 'enderman', 'endermite', 'evoker', 'ghast',
  'guardian', 'hoglin', 'husk', 'magma_cube', 'phantom',
  'piglin_brute', 'pillager', 'ravager', 'shulker', 'silverfish',
  'skeleton', 'slime', 'spider', 'stray', 'vex', 'vindicator',
  'warden', 'witch', 'wither', 'wither_skeleton', 'zoglin', 'zombie',
  'zombie_villager', 'zombified_piglin'
])

async function attackNearestHostile(
  bot,
  mobName,
  maxDistance = 16,
  options = {}
) {
  const { signal } = options
  const normalizedName = mobName
    .toLowerCase()
    .replace(/^minecraft:/, '')

  if (!HOSTILE_MOBS.has(normalizedName)) {
    bot.chat(`I will not attack ${mobName}. Choose a hostile mob.`)
    return null
  }

  const target = Object.values(bot.entities)
    .filter((entity) => {
      if (
        !entity.position ||
        entity === bot.entity ||
        entity.type === 'player'
      ) {
        return false
      }

      if (entity.name !== normalizedName) return false

      return bot.entity.position.distanceTo(entity.position) <= maxDistance
    })
    .sort((a, b) => {
      const distanceA = bot.entity.position.distanceTo(a.position)
      const distanceB = bot.entity.position.distanceTo(b.position)
      return distanceA - distanceB
    })[0]

  if (!target) {
    bot.chat(`I cannot find a ${normalizedName} within ${maxDistance} blocks.`)
    return null
  }

  if (signal && signal.aborted) {
    throw signal.reason || new Error('Combat was cancelled.')
  }

  if (bot.pvp.target) bot.pvp.forceStop()

  let resolveFight
  const fightFinished = new Promise((resolve) => {
    resolveFight = resolve
  })

  let finished = false

  const cleanup = () => {
    bot.removeListener('stoppedAttacking', onStopped)
    bot.removeListener('entityGone', onEntityGone)
    if (signal) signal.removeEventListener('abort', onAbort)
  }

  const finish = (reason) => {
    if (finished) return
    finished = true
    cleanup()
    resolveFight(reason)
  }

  const onStopped = () => finish('stopped')
  const onEntityGone = (entity) => {
    if (entity === target) finish('gone')
  }
  const onAbort = () => {
    if (bot.pvp) bot.pvp.forceStop()
    finish('cancelled')
  }

  bot.once('stoppedAttacking', onStopped)
  bot.on('entityGone', onEntityGone)
  if (signal) signal.addEventListener('abort', onAbort, { once: true })

  try {
    await bot.pvp.attack(target)
  } catch (error) {
    cleanup()
    throw error
  }

  console.log(`Earl is attacking the nearest ${normalizedName}.`)
  bot.chat(`Attacking the nearest ${normalizedName}.`)

  await fightFinished

  if (signal && signal.aborted) {
    throw signal.reason || new Error('Combat was cancelled.')
  }

  if (bot.pvp) bot.pvp.forceStop()
  bot.clearControlStates()
  await new Promise((resolve) => setImmediate(resolve))

  return target
}

module.exports = attackNearestHostile
