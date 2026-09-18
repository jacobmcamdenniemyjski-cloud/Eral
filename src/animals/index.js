const huntAnimals = require('./huntAnimal')

module.exports = {
  huntAnimals,
  PASSIVE_ANIMALS: huntAnimals.PASSIVE_ANIMALS,
  isPassiveAnimal: huntAnimals.isPassiveAnimal,
  normalizeAnimalName: huntAnimals.normalizeAnimalName
}
