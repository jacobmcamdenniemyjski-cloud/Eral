const HOSTILE_MOBS = new Set([
  'blaze',
  'bogged',
  'breeze',
  'cave_spider',
  'creeper',
  'drowned',
  'elder_guardian',
  'enderman',
  'endermite',
  'evoker',
  'ghast',
  'guardian',
  'hoglin',
  'husk',
  'magma_cube',
  'phantom',
  'piglin_brute',
  'pillager',
  'ravager',
  'shulker',
  'silverfish',
  'skeleton',
  'slime',
  'spider',
  'stray',
  'vex',
  'vindicator',
  'warden',
  'witch',
  'wither',
  'wither_skeleton',
  'zoglin',
  'zombie',
  'zombie_villager',
  'zombified_piglin'
])

async function attackNearestHostile(bot, mobName, maxDistance = 16) {
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

      if (entity.name !== normalizedName) {
        return false
      }

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

  await bot.pvp.attack(target)

  console.log(`Earl is attacking the nearest ${normalizedName}.`)
  bot.chat(`Attacking the nearest ${normalizedName}.`)

  return target
}

module.exports = attackNearestHostile
