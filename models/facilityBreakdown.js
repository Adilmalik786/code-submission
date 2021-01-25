const mongoose = require('mongoose')

const schemaName = 'FacilityBreakdown'

const schema = new mongoose.Schema(
  {
    month: String,
    csvGenerated: { type: Boolean, default: false },
    csvHash: Object,
    error: Object,
  },
  {
    timestamps: true,
  }
)

module.exports = mongoose.model(schemaName, schema)
