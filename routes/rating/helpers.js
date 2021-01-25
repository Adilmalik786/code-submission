const mongoose = require('mongoose')

const { ObjectId } = mongoose.Types

const getRatingListFilter = ({ reviewFor, agentId, facilityId }) => {
  let filter = {}

  if (reviewFor) {
    filter.reviewFor = reviewFor
  }

  if (agentId) {
    filter = {
      ...filter,
      'agent.userId': ObjectId(agentId),
    }
  }

  if (facilityId) {
    filter = {
      ...filter,
      'facility.userId': ObjectId(facilityId),
    }
  }

  return filter
}

module.exports = { getRatingListFilter }
