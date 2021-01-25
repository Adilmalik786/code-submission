const moment = require('moment-timezone')
const keyBy = require('lodash/keyBy')
const assignWith = require('lodash/assignWith')
const mapValues = require('lodash/mapValues')

const AgentModel = require('../models/agentProfile')
const { WORKER_STAGES_ENUM } = require('../../utils/worker')

const getAgentStatistics = async () => {
  const activeEnd = moment()
    .add('14', 'days')
    .toDate()

  const now = moment().toDate()

  const recentActiveStart = moment()
    .subtract('14', 'days')
    .toDate()

  const coldDate = moment()
    .subtract('3', 'days')
    .toDate()

  const agents = await AgentModel.find(
    {
      userId: { $exists: true, $ne: null },
      stage: { $ne: WORKER_STAGES_ENUM.TERMINATED },
    },
    {
      _id: 1,
      userId: 1,
      requirements: 1,
      onboardAt: 1,
      openedAt: 1,
      interestedAt: 1,
      lastWorked: 1,
      lastLogAt: 1,
      futureShiftsStaffed: 1,
    }
  )

  const statistics = {
    recentActive: 0,
    active: 0,
    inactive: 0,
    onboarding: 0,
    newUsers: 0,
    onboarded: 0,
    opened: 0,
    interested: 0,
    cold: 0,
  }

  agents.forEach(agent => {
    const { nextShift } = agent.futureShiftsStaffed || {}
    if (nextShift && nextShift > now && nextShift <= activeEnd) {
      statistics.active += 1
      return
    }

    if (agent.lastWorked && agent.lastWorked >= recentActiveStart) {
      statistics.recentActive += 1
      return
    }

    if (!agent.lastLogAt || agent.lastLogAt < coldDate) {
      // Non-Active users who have not been touched in over 3 days.
      statistics.cold += 1
    }

    if (agent.lastWorked && agent.lastWorked < recentActiveStart) {
      statistics.inactive += 1
      return
    }

    if (agent.interestedAt) {
      statistics.interested += 1
      return
    }

    if (agent.openedAt) {
      statistics.opened += 1
      return
    }

    if (agent.onboardAt) {
      statistics.onboarded += 1
      return
    }

    if (agent.requirements && agent.requirements.length) {
      statistics.onboarding += 1
      return
    }

    statistics.newUsers += 1
  })

  return statistics
}

const getAgentStagesStatistics = async () => {
  const agentStagesStatistics = await AgentModel.aggregate([
    { $group: { _id: '$stage', count: { $sum: 1 } } },
    { $project: { _id: 0, stage: '$_id', count: 1 } },
  ])

  const stagesStatistics = keyBy(agentStagesStatistics, 'stage')
  const defaultStatistics = mapValues(WORKER_STAGES_ENUM, () => 0)
  const statistics = assignWith(
    defaultStatistics,
    stagesStatistics,
    (defaultCount, statistics) => statistics.count
  )
  return statistics
}

module.exports = { getAgentStatistics, getAgentStagesStatistics }
