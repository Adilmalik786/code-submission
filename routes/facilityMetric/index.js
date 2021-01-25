const express = require('express')
const moment = require('moment-timezone')

const FacilityMetricModel = require('../../models/facilityMetric')
const FacilityProfileModel = require('../../models/facilityProfile')
const { generateFacilityMetricCSV } = require('./facilityMetricCSVHelper')
const { MissingArgsError } = require('../../errors')
const router = express.Router()

router.get('/list', async (req, res) => {
  const { csmId } = req.query
  let facilityMetricQuery = {
    monthly: { $exists: true },
  }

  if (csmId) {
    const facilities = await FacilityProfileModel.find(
      { customerSuccessManager: csmId },
      { userId: 1 }
    )
    facilityMetricQuery = {
      ...facilityMetricQuery,
      facilityId: {
        $in: facilities.map(facility => facility.userId),
      },
    }
  }

  const metricList = await FacilityMetricModel.find(facilityMetricQuery, {
    monthly: 1,
    facilityId: 1,
    date: 1,
    name: 1,
  }).lean()
  res.send(metricList)
})

router.get('/:id', async (req, res) => {
  const facilityUserId = req.params.id
  const { month } = req.query
  const metric = await FacilityMetricModel.findOne(
    {
      facilityId: facilityUserId,
      monthly: { $exists: true },
      date: moment(month)
        .startOf('month')
        .toDate(),
    },
    { monthly: 1, facilityType: 1 }
  ).lean()

  const facility = await FacilityProfileModel.findOne(
    {
      userId: facilityUserId,
    },
    { qualifiedAgents: 1, fullAddress: 1, name: 1, type: 1 }
  ).lean()

  const facilityMetric = {
    ...metric,
    facility,
  }

  res.send({ facilityMetric })
})

router.post('/churn-export', async (req, res, next) => {
  const { type, requesterEmail, date } = req.body
  if (!type || !date || !requesterEmail) {
    return next(new MissingArgsError(['type', 'date', 'requesterEmail']))
  }
  generateFacilityMetricCSV({ type, requesterEmail, date })
  res.sendStatus(200)
})

module.exports = router
