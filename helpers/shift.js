const meta = require('../../utils/meta')
const request = require('superagent')

const triggerShiftCancel = async ({ shift }) => {
    const { backupEngineUrl } = meta()
    try {
        const { body } = await request
            .post(`${backupEngineUrl}/backup-spots/removeShift`)
            .send({
                shiftId: shift._id.toString()
            })


        return body.data && body.data.data || null

    } catch(error) {
        return null
    }
}

module.exports = {
    triggerShiftCancel
}