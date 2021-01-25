const mongoose = require('mongoose')

const schemaName = 'User'


const schema = new mongoose.Schema({
  deactivated: {type: Boolean, default: false},
  email: { type: String, lowercase: true, trim: true, unique: true },
  tmz:{
    type: String,
    default: 'America/Los_Angeles',
    enum: [
      'America/Los_Angeles',
      'America/Denver',
      'America/Chicago',
      'America/New_York'
    ]
  },
  type: { type: String, index: true },
  agent: { type: mongoose.Schema.Types.ObjectId, ref: 'AgentProfile', index: true },
  facility: { type: mongoose.Schema.Types.ObjectId, ref: 'FacilityProfile', index: true },
  employee: { type: mongoose.Schema.Types.ObjectId, ref: 'EmployeeProfile', index: true },
  admin: Boolean,
  flags: {
    canClaim: { type: Boolean, default: false },
    isSignOffNotified: { type: Boolean, default: false },
    isShiftSignEnabled: { type: Boolean, default: false },
    isDailyPayNotified: { type: Boolean, default: false },
  },
  addedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  source: String,
  campaign: String,
  zenDeskId: String,
}, {
  timestamps: true
})

schema.index({ type: 1, createdAt: -1 })

module.exports = mongoose.model(schemaName, schema)
