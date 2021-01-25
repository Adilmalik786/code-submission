const { ObjectId } = require('mongoose').Types
const moment = require('moment-timezone')
const _ = require('lodash')

const ShiftModel = require('../models/shift')
const AgentActivityLogModel = require('../models/agentActivityLog')
const { getAgentQualifiedFacilities } = require('../helpers/facility')
const { toArrayObjectIds } = require('../../utils/array')
const { workerTypeObj } = require('../../utils/worker')

const getAgentUnreadShifts = async ({ agentId, optOutOfText }) => {

  let agents = await getAgentQualifiedFacilities({ agentId, optOutOfText })
  const calendarOpenTime = await getCalendarOpenTime(agentId)
  const openShifts = await getOpenShifts()

  agents = agents.map((agent) => {
    const openTime = _.get(calendarOpenTime, `${agent.userId}.createdAt`)
    const shiftTypes = [agent.qualification]
    if (agent.qualification === workerTypeObj.LVN || agent.qualification === workerTypeObj.RN) {
      shiftTypes.push('NURSE')
    }

    let unreadShifts = []

    unreadShifts = openShifts.filter(shift => {
      return (
        (!openTime || shift.createdAt > openTime) &&
        shiftTypes.includes(shift.agentReq) &&
        agent.qualifiedFacilities.find(facility => ObjectId(shift.facilityId).equals(ObjectId(facility)))
      )
    })
    // some of the agent has rate 0, setting min rate
    const agentRate = agent.rate || 14

    const uniqByFacility = (a, b) => _.isEqual(a.facilityId, b.facilityId)
    const sumByAmount = shift => shift.time * agentRate

    return {
      _id: agent.userId,
      name: agent.name,
      phone: agent.phone,
      rate: agent.rate,
      notifyFlags: agent.notifyFlags,
      calendarOpenTime: openTime,
      unreadShiftCount: unreadShifts.length,
      totalTime: _.sumBy(unreadShifts, 'time'),
      totalAmount: _.sumBy(unreadShifts, sumByAmount),
      facilityCount: _.uniqWith(unreadShifts, uniqByFacility).length,
    }
  })

  return agents
}

const getCalendarOpenTime = async (agentId) => {

  const filter = {
    type: 'CALENDAR_OPEN'
  }

  if (agentId) {
    filter.agentId = { $in: toArrayObjectIds(agentId) }
  }

  const calendarOpenTime = await AgentActivityLogModel.aggregate([
    {
      $match: filter
    },
    {
      $sort: {
        createdAt: -1
      }
    },
    {
      $group: {
        _id: '$agentId',
        createdAt: {
          $first: '$createdAt'
        }
      }
    }
  ])

  return _.keyBy(calendarOpenTime, '_id')
}

const getOpenShifts = async () => {
  const openShifts = await ShiftModel.aggregate([
    {
      $match: {
        start: { $gte: moment().toDate() },
        agentId: null,
        deleted: { $ne: true }
      }
    },
    {
      $group: {
        _id: { facilityId: '$facilityId', start: '$start', end: '$end' },
        shiftId: {
          $first: '$_id'
        },
        facilityId: { $first: '$facilityId' },
        createdAt: { $first: '$createdAt' },
        time: { $first: '$time' },
        agentReq: { $first: '$agentReq' },
      }
    }
  ])

  return openShifts
}

module.exports = { getAgentUnreadShifts }
