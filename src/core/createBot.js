const mineflayer = require('mineflayer')

function createBot() {
  return mineflayer.createBot({
    host: 'localhost',
    port: 25565,
    username: 'earl',
    auth: 'offline',
    version: '1.21.11'
  })
}

module.exports = createBot