const { Schema, model } = require('mongoose')

const { allShiftReqTypes } = require('../../utils/worker')

const { ObjectId } = Schema.Types

const schemaName = 'FacilityMetric'

const FacilityShiftCountSchema = new Schema(
  {
    requested: { type: Number, default: 0 },
    filled: { type: Number, default: 0 },
    fillRate: { type: Number, default: 0 },
    uniqueWorkers: { type: Number, default: 0 },
  },
  {
    _id: false,
    timestamps: false,
  }
)

const FacilityShiftRevenueSchema = new Schema(
  {
    expected: { type: Number, default: 0 },
    net: { type: Number, default: 0 },
    gross: { type: Number, default: 0 },
    avgMargin: { type: Number, default: 0 },
  },
  {
    _id: false,
    timestamps: false,
  }
)

const MetricSchema = new Schema(
  {
    currentShifts: FacilityShiftCountSchema,
    previousShifts: FacilityShiftCountSchema,
    churnShifts: FacilityShiftCountSchema,

    currentRevenue: FacilityShiftRevenueSchema,
    previousRevenue: FacilityShiftRevenueSchema,
    churnRevenue: FacilityShiftRevenueSchema,
  },
  {
    _id: false,
    timestamps: false,
  }
)

const workerTypeModel = allShiftReqTypes.reduce(
  (acc, type) => ({
    ...acc,
    [type]: MetricSchema,
  }),
  {}
)

const BreakDownByReqTypeSchema = new Schema(
  {
    ...workerTypeModel,
    all: MetricSchema,
  },
  {
    _id: false,
    timestamps: false,
  }
)

const FacilityMetricSchema = new Schema(
  {
    facilityId: { type: ObjectId, required: true },
    facilityType: { type: String, required: true },
    name: { type: String, required: true },
    date: { type: Date, required: true }, // start of day

    daily: BreakDownByReqTypeSchema,
    weekly: BreakDownByReqTypeSchema, // NONNull value in start of week
    monthly: BreakDownByReqTypeSchema, // NONNull value in start of month
  },
  {
    timestamps: true,
  }
)

FacilityMetricSchema.index({ month: -1, facilityId: -1 })

module.exports = model(schemaName, FacilityMetricSchema, 'facilityMetrics')
