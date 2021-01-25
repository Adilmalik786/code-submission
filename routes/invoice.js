const express = require('express')
const mongoose = require('mongoose')
const get = require('lodash/get')
const moment = require('moment-timezone')

const InvoiceModel = require('../models/invoice')
const FacilityProfileModel = require('../models/facilityProfile')
const ShiftModel = require('../models/shift')
const { getInvoicePeriodFilter } = require('../helpers/invoice')
const { httpError } = require('../../utils/errors')

const router = express.Router()
const { ObjectId } = mongoose.Types

const InvoiceMatchFilters = ({ invoiceNumber, facilityId, status }) => {
  let matchQuery = {}
  if (invoiceNumber) {
    matchQuery['count'] = parseInt(invoiceNumber, 10)
  }

  if (facilityId) {
    matchQuery['facilityId'] = ObjectId(facilityId)
  }

  if (status) {
    if (status === 'paid') {
      matchQuery['paid'] = true
    } else if (status === 'partiallyPaid') {
      matchQuery['partiallyPaid'] = true
    } else if (status === 'notPaid') {
      matchQuery['paid'] = false
      matchQuery['partiallyPaid'] = { $ne: true }
    }
  }

  matchQuery['archived'] = false

  return matchQuery
}

router.get('/', async (req, res) => {
  let pipeline = []
  const { pageNumber = 1, limit = 10, salesOwner = '' } = req.query

  const matchQuery = InvoiceMatchFilters(req.query)

  const salesOwnerQuery = salesOwner
    ? { $match: { 'facility.salesManager': ObjectId(salesOwner) } }
    : { $match: {} }

  pipeline.push(
    { $match: matchQuery },
    { $sort: { count: -1 } },
    {
      $lookup: {
        from: 'facilityprofiles',
        localField: 'facilityId',
        foreignField: 'userId',
        as: 'facility',
      },
    },
    { $unwind: { path: '$facility' } },
    salesOwnerQuery,
    { $skip: (pageNumber - 1) * limit },
    { $limit: parseInt(limit, 10) },
    {
      $lookup: {
        from: 'users',
        localField: 'facility.salesManager',
        foreignField: '_id',
        as: 'salesManager',
      },
    },
    { $unwind: { path: '$salesManager', preserveNullAndEmptyArrays: true } },
    {
      $project: {
        shifts: {
          $reduce: {
            input: '$data.shifts',
            initialValue: { amount: 0, profit: 0 },
            in: {
              amount: { $add: ['$$value.amount', '$$this.amount'] },
              profit: { $add: ['$$value.profit', '$$this.profit'] },
            },
          },
        },
        lineItems: {
          $reduce: {
            input: '$data.lineItems',
            initialValue: { amount: 0, profit: 0 },
            in: {
              amount: { $add: ['$$value.amount', '$$this.amount'] },
              profit: { $add: ['$$value.profit', '$$this.profit'] },
            },
          },
        },
        invoiceNumber: '$count',
        start: '$start',
        end: '$end',
        period: '$period',
        paid: '$paid',
        partiallyPaid: '$partiallyPaid',
        paidAmount: '$paidAmount',
        facility: {
          _id: '$facilityId',
          name: '$facility.name',
        },
        salesManager: {
          _id: { $ifNull: ['$salesManager._id', 'unknown'] },
          email: {
            $ifNull: ['$salesManager.email', 'unknown@clipboardhealth.com'],
          },
        },
      },
    }
  )

  const invoiceList = await InvoiceModel.aggregate(pipeline)

  res.send({
    invoiceList,
  })
})

router.get('/count', async (req, res) => {
  let pipeline = []
  const { salesOwner } = req.query

  const matchQuery = InvoiceMatchFilters(req.query)

  pipeline.push(
    { $match: matchQuery },
    {
      $project: {
        facilityId: '$facilityId',
      },
    },
    { $sort: { _id: -1 } }
  )

  if (salesOwner) {
    pipeline.push(
      {
        $lookup: {
          from: 'facilityprofiles',
          localField: 'facilityId',
          foreignField: 'userId',
          as: 'facility',
        },
      },
      {
        $unwind: { path: '$facility' },
      },
      {
        $match: { 'facility.salesManager': ObjectId(salesOwner) },
      }
    )
  }
  pipeline.push({ $count: 'total' })

  const invoiceCount = await InvoiceModel.aggregate(pipeline)

  res.send({
    total: get(invoiceCount, '[0].total', 0),
  })
})

router.put('/', async (req, res) => {
  const { invoiceId, ...data } = req.body

  const result = await InvoiceModel.findOneAndUpdate(
    {
      _id: invoiceId,
    },
    {
      $set: data,
    },
    {
      new: true,
      fields: { 
        paid: 1,
        partiallyPaid: 1,
        paidAmount: 1,
      },
    }
  )

  res.send({ invoice: result })
})

router.get('/list/by-facilities', async (req, res, next) => {
  const { page = 1, start, limit = 10, name, facilityId } = req.query
  if (!start) {
    return next(httpError('Missing required params (start)', 400))
  }

  const startFilter = getInvoicePeriodFilter(start)

  const facilityFilters = {
    userId: { $exists: true },
  }

  if (name) {
    facilityFilters['name'] = new RegExp(name, 'i')
  }

  if (facilityId) {
    facilityFilters['userId'] = ObjectId(facilityId)
  }

  const result = await FacilityProfileModel.aggregate([
    {
      $match: facilityFilters,
    },
    {
      $sort: { _id: -1 },
    },
    {
      $skip: (Number(page) - 1) * Number(limit),
    },
    {
      $limit: Number(limit),
    },
    {
      $lookup: {
        from: 'invoices',
        as: 'invoice',
        let: { userId: '$userId' },
        pipeline: [
          {
            $match: {
              $expr: {
                $and: [
                  { $eq: ['$$userId', '$facilityId'] },
                  { $ne: ['$archived', true] },
                ],
              },
              ...startFilter,
            },
          }
        ],
      },
    },
    {
      $unwind: { path: '$invoice', preserveNullAndEmptyArrays: true },
    },
    {
      $project: {
        name: 1,
        phone: 1,
        email: 1,
        userId: 1,
        fullAddress: 1,
        createdAt: 1,
        updatedAt: 1,
        invoice: {
          _id: 1,
          count: 1,
          sentAt: 1,
          createdAt: 1,
          updatedAt: 1,
        },
      },
    },
  ])

  res.send({
    data: result,
  })
})

router.get('/history', async (req, res) => {
  const { facilityId, year } = req.query
  const query = {
    facilityId: ObjectId(facilityId),
    'period.start': { $gte: moment(`${year}-01-01`).format('YYYY-MM-DD') },
    'period.end': { $lte: moment(`${year}-12-31`).endOf('day').format('YYYY-MM-DD') },
    archived: false
  }

  const invoices = await InvoiceModel.aggregate([
    {
      $match: query
    },
    { $sort: { count: -1 } },
    {
      $project: {
        shifts: {
          $reduce: {
            input: '$data.shifts',
            initialValue: { amount: 0, hours: 0 },
            in: {
              amount: { $add: ['$$value.amount', '$$this.amount'] },
              hours: { $add: ['$$value.hours', '$$this.hours'] }
            },
          },
        },
        lineItems: {
          $reduce: {
            input: '$data.lineItems',
            initialValue: { amount: 0 },
            in: {
              amount: { $add: ['$$value.amount', '$$this.amount'] },
            },
          },
        },
        invoiceNumber: '$count',
        period: '$period',
        paid: '$paid',
        partiallyPaid: '$partiallyPaid',
        paidAmount: '$paidAmount',
        totalShifts: { $cond: { if: { $isArray: "$data.shifts" }, then: { $size: "$data.shifts" }, else: 0 } }
      }
    }
  ])
  res.send({
    invoices
  })
})

router.get('/current', async (req, res) => {
  const { start, end, facilityId } = req.query
  const shiftsData = await ShiftModel.aggregate([
    {
      $match: {
        start: { $gte: moment(start).toDate() },
        end: { $lte: moment(end).toDate() },
        $or: [{deleted: true, isBillable: true}, {deleted: {$ne: true}} ],
        facilityId: ObjectId(facilityId)
      }
    },
    {
      $project: {
        forecastedAmount: {
          $sum: {
            $multiply: ["$charge", "$time"]
          }
        },
        verifiedAmount: {
          $sum: {
            $cond: {
              if: { $gt: ['$agentId', null] },
              then: { $multiply: ['$charge', '$time'] },
              else: 0
            }
          }
        }
      }
    }
  ])

  const data = shiftsData.reduce((acc, el) => {
    return {
      verifiedAmount: acc.verifiedAmount + el.verifiedAmount,
      forecastedAmount: acc.forecastedAmount + el.forecastedAmount
    }
  }, { verifiedAmount: 0, forecastedAmount: 0 })
  return res.send({
    data
  })
})

module.exports = router
