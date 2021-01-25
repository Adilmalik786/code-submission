const mongoose = require('mongoose')
const { Address, Point } = require('./geoSchema')
const { Image } = require('./imageSchema')
const { workerTypeModel, workerSpecialities } = require('../../utils/worker')
const { facilityTypes, chartingTypes, FacilityStatus, FacilityStatusObj, InstantBookConfigurationTypes } = require('../../utils/facility')

const schemaName = 'FacilityProfile'

const workerAllTypesModel = {
  ...workerTypeModel,
  other: { type: Number, default: 0 },
}

const QualifiedAgent = new mongoose.Schema({
  qualified: { ...workerAllTypesModel },
  potential: { ...workerAllTypesModel },
})

const QualifiedAgentsBreakdown = new mongoose.Schema({
  qualified: {
    25: { ...workerAllTypesModel },
    50: { ...workerAllTypesModel },
    75: { ...workerAllTypesModel },
    100: { ...workerAllTypesModel },
  },
  potential: {
    25: { ...workerAllTypesModel },
    50: { ...workerAllTypesModel },
    75: { ...workerAllTypesModel },
    100: { ...workerAllTypesModel },
  }
})

const authorizedSignatory = new mongoose.Schema({
  name: String,
  role: String,
  phone: String,
  email: String,
  notes: String,
  // Type String is deprecated and will be removed after migration
  signature: Image | String,
  addedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
}, {
  timestamps: true,
})

const schema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  name: { type: String, default: "", trim: true },
  email: { type: String, lowercase: true, trim: true },
  description: String, // For Surgery Centers
  profileDescription: String,
  status: { type: String, default: FacilityStatusObj.ONBOARDING, enum: FacilityStatus },
  isCritical: { type: Boolean, default: false },
  type: {
    type: String,
    enum: facilityTypes
  },
  // deprecated: Use `fullAddress`
  address: { type: String, default: "" },
  phone: { type: String, default: "", trim: true },
  tmz: {
    type: String,
    default: 'America/Los_Angeles',
    enum: [
      'America/Los_Angeles',
      'America/Denver',
      'America/Chicago',
      'America/New_York',
    ],
  },
  note: String,
  surgeryTypes: [{ type: String, enum: workerSpecialities }],
  numberOfBeds: { type: Number, min: 0 },
  additionalDetails: { type: String },
  chartingType: { type: String, enum: chartingTypes },
  cancelInstructions: String,
  location: { type: mongoose.Schema.Types.ObjectId, ref: "Location" },
  coordinators: [{
    name: String,
    phone: String,
    email: String,
    notes: String
  }],
  payroll: {
    name: String,
    email: String
  },
  rates: { ...workerTypeModel },
  requiredDocuments: [{ type: mongoose.Schema.Types.ObjectId, ref: "Document" }],
  invoicePeriod: {
    type: String,
    enum: [
      'WEEKLY',
      'SEMI-MONTHLY'
    ]
  },
  qualifiedAgents: QualifiedAgent,
  qualifiedAgentsBreakdown: QualifiedAgentsBreakdown,
  nurseAccountManager: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  customerSuccessManager: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  salesManager: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  notifyShiftAssignment: { type: Boolean, default: true },
  requireTimecardPhoto: { type: Boolean, default: false },
  authorizedSignatories: { type: [authorizedSignatory], default: [] },
  fullAddress: Address,
  geoLocation: Point,
  futureShiftsStaffed: {
    sum: Number,
    nextShift: Date,
    updatedAt: Date,
  },
  ratesTable: {
    sunday: { am: Number, pm: Number, noc: Number, surg: Number },
    monday: { am: Number, pm: Number, noc: Number, surg: Number },
    tuesday: { am: Number, pm: Number, noc: Number, surg: Number },
    wednesday: { am: Number, pm: Number, noc: Number, surg: Number },
    thursday: { am: Number, pm: Number, noc: Number, surg: Number },
    friday: { am: Number, pm: Number, noc: Number, surg: Number },
    saturday: { am: Number, pm: Number, noc: Number, surg: Number },
  },
  instantBook: { 
    type: String, 
    default: 'OFF',
    enum: InstantBookConfigurationTypes
  },
  lastLogAt: Date,
  payOnHoliday: { type: Boolean, default: false },
  payOnAllHolidays: { type: Boolean, default: false },
  holidayList: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: "Holiday" }] },
  rating: {
    count: { type: Number, default: 0 },
    value: { type: Number, default: 0 },
  },
  shiftVerificationInstructions: String,
  shiftConfirmationInstructions: String,
  checkInInstructions: {
    type: String,
    default: ''
  },
  rushFee: {
    differential: Number,
    period: Number,
  },
  lateCancellation: {
    period: { type: Number, default: 24, max: 1000, min: 0 },
    feeHours: { type: Number, default: 2, max: 1000, min: 0 },
  },
  netTerms: { type: Number, default: 30, max: 1000, min: 0 },
  callFacilityOnSelfClaim: { type: Boolean, default: false },
  instantBookCallInstructions: { type: String, default: '' },
}, {
  timestamps: true
})

schema.index({ userId: 1 }, { unique: true, sparse: true })
schema.index({ name: 'text' })
schema.index({ geoLocation: '2dsphere' })

module.exports = mongoose.model(schemaName, schema)
