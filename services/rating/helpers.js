const mongoose = require('mongoose')

const ShiftModel = require('../../models/shift')
const RatingModel = require('../../models/rating')
const logger = require('../../../utils/logger')

const { ObjectId } = mongoose.Types

const getShiftInfo = async shiftId => {
  const [shift] = await ShiftModel.aggregate([
    {
      $match: {
        _id: ObjectId(shiftId),
      },
    },
    {
      $lookup: {
        from: 'facilityprofiles',
        localField: 'facilityId',
        foreignField: 'userId',
        as: 'facility',
      },
    },
    { $unwind: '$facility' },
    {
      $lookup: {
        from: 'agentprofiles',
        localField: 'agentId',
        foreignField: 'userId',
        as: 'agent',
      },
    },
    {
      $unwind: { path: '$agent' },
    },
  ])

  return shift
}

const getCumulativeRating = async ({ reviewFor, facilityId, agentId }) => {
  let filter = { reviewFor }

  if (facilityId) {
    filter = { 'facility.userId': facilityId }
  } else if (agentId) {
    filter = { 'agent.userId': agentId }
  }

  if (!reviewFor) {
    logger.error(`Rating Service: ${JSON.stringy({ reviewFor, facilityId, agentId })}`)
  }

  const [rating] = await RatingModel.aggregate([
    {
      $match: filter,
    },
    {
      $group: {
        _id: '$reviewFor',
        total: { $sum: 1 },
        avg: { $avg: '$rating' },
      },
    },
  ])

  return rating || { reviewFor, total: 0, avg: 0 }
}

module.exports = { getShiftInfo, getCumulativeRating }
