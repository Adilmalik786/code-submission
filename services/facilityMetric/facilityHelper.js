const FacilityMetricModel = require('../../models/facilityMetric')
const FacilityModel = require('../../models/facilityProfile')

const findFacilityMetric = async (facilityId, date) => {
  return await FacilityMetricModel.findOne({ facilityId, date }).lean()
}

const upsertFacilityMetric = async doc => {
  return await FacilityMetricModel.updateOne(
    { facilityId: doc.facilityId, date: doc.date },
    { $set: doc },
    { upsert: true }
  )
}

const getFacilityInfo = facilityId =>
  FacilityModel.findOne({ userId: facilityId })

module.exports = { findFacilityMetric, upsertFacilityMetric, getFacilityInfo }
