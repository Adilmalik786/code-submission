const express = require('express')
const mongoose = require('mongoose')
const RatingModel = require('../../models/rating')
const ShiftModel = require('../../models/shift')
const FacilityProfileModel = require('../../models/facilityProfile')
const AgentProfileModel = require('../../models/agentProfile')

const { authMiddleware } = require('../../../utils/firebase')
const { httpError } = require('../../../utils/errors')
const { serviceEvent } = require('../../events')
const { getRatingListFilter } = require('./helpers')

const router = express.Router()
const { ObjectId } = mongoose.Types

router.post('/', authMiddleware(true), async (req, res, next) => {
  const { userId, body } = req
  const {
    rating,
    reasons,
    otherReason,
    review,
    shiftId,
    reviewFor,
    id
  } = body

  let reviewedBy = id || userId

  if (reviewFor === 'AGENT' && !id) {
    reviewedBy = null
  }

  if (!shiftId) {
    return next(httpError('Invalid shift.', 500))
  }

  const ratingInfo = await RatingModel.create({
    rating,
    reasons,
    otherReason,
    review,
    reviewFor,
    shift: {
      _id: shiftId,
    },
    reviewedBy,
  })

  const shift = await ShiftModel.findOneAndUpdate(
    { _id: shiftId },
    { $set: { rating: { [reviewFor]: rating } } },
    { new: true, fields: { rating: 1, facilityId: 1 } }
  )

  serviceEvent.emit('newRating', ratingInfo)

  res.send(shift)
})

router.get('/', async (req, res) => {
  const { reviewFor, shiftId } = req.query
  const review = await RatingModel.find({
    'shift._id': ObjectId(shiftId),
    reviewFor,
  }, { _id: 1 })

  res.send(review)
})

router.get('/count', async (req, res) => {
  const { filter } = req.query
  const match = getRatingListFilter(filter || {})
  const count = await RatingModel.countDocuments(match)
  res.send({ count })
})

router.get('/list', async (req, res) => {
  const { filter, page } = req.query
  const match = getRatingListFilter(filter || {})

  const ratings = await RatingModel.aggregate([
    {
      $match: match,
    },
    {
      $sort: {
        _id: -1,
      },
    },
    {
      $skip: (page - 1) * 10,
    },
    {
      $limit: 10,
    },
  ])
  res.send(ratings)
})

module.exports = router
