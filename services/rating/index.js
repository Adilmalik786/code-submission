const AgentModel = require('../../models/agentProfile')
const FacilityModel = require('../../models/facilityProfile')
const RatingModel = require('../../models/rating')
const logger = require('../../../utils/logger')

const { getShiftInfo, getCumulativeRating } = require('./helpers')

const RatingService = serviceEvent => {
  serviceEvent.on('newRating-rating', handleNewRating)
}

const handleNewRating = async ({ _id, shift, reviewFor }) => {
  const shiftInfo = await getShiftInfo(shift._id)

  await updateRatingInfo(_id, shiftInfo)

  const options = { reviewFor }

  if (reviewFor === 'FACILITY') {
    options.facilityId = shiftInfo.facilityId
  } else if (reviewFor === 'AGENT') {
    options.agentId = shiftInfo.agentId
  } else {
    logger.error(`Rating Service: ${JSON.stringy({ _id, shift, reviewFor })}`)
    return
  }

  return await updateCumulativeRating(options)
}

const updateCumulativeRating = async options => {
  const ratingInfo = await getCumulativeRating(options)

  const updateValue = {
    rating: { count: ratingInfo.total, value: ratingInfo.avg },
  }

  if (options.reviewFor === 'FACILITY') {
    return updateFacility(options.facilityId, updateValue)
  } else if (options.reviewFor === 'AGENT') {
    return updateAgent(options.agentId, updateValue)
  }
}

const updateFacility = async (userId, updateValue) => {
  return await FacilityModel.updateOne({ userId }, { $set: updateValue })
}

const updateAgent = async (userId, updateValue) => {
  return await AgentModel.updateOne({ userId }, { $set: updateValue })
}

const updateRatingInfo = async (ratingId, shift) => {
  await RatingModel.updateOne(
    { _id: ratingId },
    { $set: { facility: shift.facility, agent: shift.agent, shift: shift } }
  )
}

module.exports = { RatingService }
