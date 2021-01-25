const { CronJob } = require('cron')

const AgentModel = require('../models/agentProfile')

const AgentCheckAvailableStatusService = () => {
  const every30mins = '00 */30 * * * *'
  const timezone = 'America/Los_Angeles'

  const cronOptions = {
    cronTime: every30mins,
    onTick: checkAvailableAgents,
    start: true,
    timezone,
  }
  new CronJob(cronOptions)
}

const checkAvailableAgents = async () => {
  await AgentModel.updateMany(
    { isAvailable: true, availableUntil: { $lte: new Date() } },
    { $set: { isAvailable: false, availableUntil: null }}
  )
}

module.exports = { AgentCheckAvailableStatusService }
