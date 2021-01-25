const mongoose = require('mongoose')

const schemaName = 'Invoice'

const schema = new mongoose.Schema({
  facilityId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  count: {
    type: Number,
    unique: true
  },
  start: { type: Date, index: true },
  end: Date,
  period: {
    start: { type: String },
    end: { type: String },
  },
  data: Object,
  sentAt: Date,
  archived: { type: Boolean, default: false },
  paidAmount: { type: Number, default: 0},
  paid: { type: Boolean, default: false },
  partiallyPaid: { type: Boolean, default: false },
  expiryInDays: { type: Number, default: 30 }
},{
  timestamps: true
})

schema.index({ 'period.start': -1, count: -1 })

module.exports = mongoose.model(schemaName, schema)
