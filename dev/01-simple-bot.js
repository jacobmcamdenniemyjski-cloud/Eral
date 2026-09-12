const mineflayer = require('mineflayer');

// Setup bot connection
const bot = mineflayer.createBot({
  host: 'localhost',
  port: '25565',
  username: "earl",
  auth: 'offline',
  version: '1.21.11'
})
