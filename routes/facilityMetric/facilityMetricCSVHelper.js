const moment = require('moment-timezone')
const { keyBy } = require('lodash')
const fs = require('fs')
const { promisify } = require('util')
const FacilityMetricModel = require('../../models/facilityMetric')
const { sendFacilityChurnCsvEmail } = require('../../../utils/email')
const { formatFacilityChurnData, getFacilityCSVData, getCSVFileName } = require('../../services/churnExport')
const writeFileAsync = promisify(fs.writeFile)
const unlinkFileAsync = promisify(fs.unlink)
const logger = require('../../../utils/logger')
const { GRANULARITY_TYPES } = require('../../../utils/facilityMetrics')
const FacilityProfileModel = require('../../models/facilityProfile')

const getFacilityProjection = () => ({
  'name': 1,
  'type': 1,
  'userId': 1,
  'createdAt': 1,
  'fullAddress.city': 1,
  'fullAddress.state': 1,
  'qualifiedAgentsBreakdown.qualified': 1,
})

const getMetricsProjection = type => ({
  'facilityId': 1,
  [`${type}.all`]: 1,
})

const getSelectedDate = (type, date) => {
  const periodType = type === GRANULARITY_TYPES.MONTHLY ? 'month': 'week'
  return moment(date).startOf(periodType)
}

const generateFacilityMetricCSV = async ({ type, requesterEmail, date }) => {
  try {
    const facilityProjection = getFacilityProjection()
    const metricsProjection = getMetricsProjection(type)
    const selectedDate = getSelectedDate(type, date)

    const facilities = await FacilityProfileModel
      .find({ userId: { $exists: true, $ne: null } }, facilityProjection)
      .lean()

    const metrics = await FacilityMetricModel
      .find({ date: selectedDate }, metricsProjection)
      .lean()

    const metricsById = keyBy(metrics, 'facilityId')

    const data = facilities.map(facility => ({ ...metricsById[facility.userId], ...facility }))

    const formattedData = formatFacilityChurnData(data, type, selectedDate)
    const csvData = getFacilityCSVData(formattedData, selectedDate, type)
    const fileName = getCSVFileName(type, selectedDate)

    await writeFileAsync(fileName, csvData)
    logger.info(`Sending Facility ${type} churn csv to ${requesterEmail}`)
    await sendFacilityChurnCsvEmail({ fileName, email: requesterEmail })
    await unlinkFileAsync(fileName)
  } catch (error) {
    logger.error(`Error in Facility Churn Export Email : type -> ${type}, requester -> ${requesterEmail}, error -> ${error}`)
    await sendFacilityChurnCsvEmail({ email: requesterEmail, error })
  }
}

module.exports = { generateFacilityMetricCSV }
