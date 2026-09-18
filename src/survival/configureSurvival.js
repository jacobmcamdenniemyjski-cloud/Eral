const BANNED_FOOD = [
  'rotten_flesh',
  'spider_eye',
  'poisonous_potato',
  'pufferfish',
  'chorus_fruit',
  'chicken',
  'suspicious_stew',
  'golden_apple'
]

function configureSurvival(bot, options = {}) {
  const actionCoordinator = options.actionCoordinator || null
  let armorTimer = null
  let equippingArmor = false
  let armorDeferred = false

  function isArmor(item) {
    return Boolean(
      item &&
      ['_helmet', '_chestplate', '_leggings', '_boots']
        .some((suffix) => item.name.endsWith(suffix))
    )
  }

  async function equipBestArmor() {
    if (
      !bot.armorManager ||
      equippingArmor ||
      (actionCoordinator && actionCoordinator.isBusy())
    ) {
      armorDeferred = true
      return
    }

    equippingArmor = true

    try {
      await bot.armorManager.equipAll()
    } catch (error) {
      console.error(`Automatic armor equip failed: ${error.message}`)
    } finally {
      equippingArmor = false
      armorDeferred = false
    }
  }

  if (actionCoordinator) {
    actionCoordinator.on('started', () => {
      if (bot.autoEat && typeof bot.autoEat.disable === 'function') {
        bot.autoEat.disable()
      }
    })
    actionCoordinator.on('idle', () => {
      if (bot.autoEat && typeof bot.autoEat.enable === 'function') {
        bot.autoEat.enable()
      }
      if (armorDeferred) scheduleArmorCheck()
    })
  }

  function scheduleArmorCheck() {
    clearTimeout(armorTimer)
    armorTimer = setTimeout(equipBestArmor, 200)
  }

  function initializeAutoEat() {
    if (!bot.autoEat) {
      console.error('Automatic eating plugin failed to initialize.')
      return
    }

    bot.autoEat.options = {
      ...bot.autoEat.options,
      priority: 'foodPoints',
      startAt: 15,
      eatingTimeout: 5000,
      offhand: false,
      bannedFood: BANNED_FOOD,
      equipOldItem: true,
      checkOnItemPickup: true
    }

    bot.on('autoeat_started', (food) => {
      console.log(`Earl started eating ${food.name}.`)
    })

    bot.on('autoeat_finished', (food) => {
      console.log(`Earl finished eating ${food.name}.`)
    })

    bot.on('autoeat_error', (error) => {
      if (error.message !== 'No food found.') {
        console.error(`Automatic eating failed: ${error.message}`)
      }
    })

    bot.autoEat.enable()

    bot.inventory.on('updateSlot', (slot, oldItem, newItem) => {
      if (isArmor(oldItem) || isArmor(newItem)) {
        scheduleArmorCheck()
      }
    })
  }

  if (bot.autoEat) {
    initializeAutoEat()
  } else {
    bot.once('inject_allowed', initializeAutoEat)
  }

  bot.on('spawn', () => {
    if (bot.autoEat) {
      bot.autoEat.enable()
    }

    scheduleArmorCheck()
  })
}

module.exports = configureSurvival
