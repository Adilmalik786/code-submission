/**
 * AgentAttendanceService
 * Usage: Check and Update attendance for agents when a shift update event is triggered
 * Listens to 'shiftUpdate' event of serviceEvent
 *
 */

const mongoose = require('mongoose')
const moment = require('moment-timezone')

const ShiftModel = require('../models/shift')
const AgentModel = require('../models/agentProfile')
const EventModel = require('../models/event')

const { ObjectId } = mongoose.Types

const AgentAttendanceService = serviceEvent => {
  serviceEvent.on('shiftUpdate-agentAttendance', handleShiftUpdate)
}

const handleShiftUpdate = async ({ agentId, unassignedAgentId }) => {
  if (agentId) {
    return await fetchAndUpdateAttendance(agentId)
  }

  if (unassignedAgentId) {
    return await fetchAndUpdateAttendance(unassignedAgentId)
  }
}

const fetchAndUpdateAttendance = async agentId => {
  agentId = ObjectId(agentId)

  const completedShifts = await getCompletedShifts(agentId)
  const cancelledShifts = await getCancelledShifts(agentId)

  const totalShifts = completedShifts.concat(cancelledShifts)
  totalShifts.sort((a, b) => b.start - a.start)

  const consecutive =  totalShifts.findIndex(shift => shift.cancelled)
  const consecutiveCancels = totalShifts.findIndex(shift => !shift.cancelled)

  const attendance = {
    completedShifts: completedShifts.length,
    cancelledShifts: cancelledShifts.length,
    totalShifts: totalShifts.length,
    consecutive: consecutive < 0 ? totalShifts.length : consecutive,
    consecutiveCancels: consecutiveCancels < 0 ? totalShifts.length : consecutiveCancels,
    percentage: 0,
  }

  if (attendance.totalShifts > 0) {
    attendance.percentage = Math.round(
      (attendance.completedShifts / attendance.totalShifts) * 100
    )
  }

  return updateAgentAttendance(agentId, attendance)
}

const getCompletedShifts = agentId => {
  const now = moment().toDate()

  return ShiftModel.aggregate([
    {
      $match: {
        agentId,
        end: { $lte: now },
        deleted: { $ne: true },
      },
    },
    {
      $project: {
        _id: 1,
        start: 1,
        cancelled: { $literal: false },
      },
    },
  ])
}

const getCancelledShifts = agentId => {
  return EventModel.aggregate([
    {
      $match: {
        event: { $in: ['AGENT_CANCEL', 'NO_CALL_NO_SHOW'] },
        agent: agentId,
      },
    },
    {
      $lookup: {
        from: 'shifts',
        localField: 'shift',
        foreignField: '_id',
        as: 'shift',
      },
    },
    {
      $unwind: { path: '$shift' },
    },
    {
      $project: {
        _id: '$shift._id',
        start: '$shift.start',
        isNoCallNoShow: { $eq: ['$event', 'NO_CALL_NO_SHOW'] },
        cancelled: { $literal: true },
      },
    },
  ])
}

const updateAgentAttendance = async (agentId, attendance) => {
  const updatedAt = moment().toDate()
  const sortMeta = attendance.totalShifts > 0 ? 1 : 0

  return await AgentModel.updateOne(
    { userId: agentId },
    { $set: { attendance: { ...attendance, updatedAt, sortMeta } } }
  )
}

module.exports = { AgentAttendanceService, fetchAndUpdateAttendance }
