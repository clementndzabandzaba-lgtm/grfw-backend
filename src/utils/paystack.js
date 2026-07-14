const https  = require('https')
const crypto = require('crypto')

const secret = () => process.env.PAYSTACK_SECRET_KEY || ''

function paystackGet(path) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'api.paystack.co',
      port: 443,
      path,
      method: 'GET',
      headers: { Authorization: `Bearer ${secret()}` },
    }
    const req = https.request(opts, (res) => {
      let data = ''
      res.on('data', (c) => { data += c })
      res.on('end', () => { try { resolve(JSON.parse(data)) } catch (e) { reject(e) } })
    })
    req.on('error', reject)
    req.end()
  })
}

async function verifyTransaction(reference) {
  return paystackGet(`/transaction/verify/${encodeURIComponent(reference)}`)
}

function verifyWebhookSignature(body, signature) {
  const payload = typeof body === 'string' ? body : JSON.stringify(body)
  const hash = crypto.createHmac('sha512', secret()).update(payload).digest('hex')
  return hash === signature
}

module.exports = { verifyTransaction, verifyWebhookSignature }
