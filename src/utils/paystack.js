const https  = require('https')
const crypto = require('crypto')

const secret = () => process.env.PAYSTACK_SECRET_KEY || ''

function paystackRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null
    const opts = {
      hostname: 'api.paystack.co',
      port: 443,
      path,
      method,
      headers: {
        Authorization: `Bearer ${secret()}`,
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    }
    const req = https.request(opts, (res) => {
      let data = ''
      res.on('data', (c) => { data += c })
      res.on('end', () => { try { resolve(JSON.parse(data)) } catch (e) { reject(e) } })
    })
    req.on('error', reject)
    if (payload) req.write(payload)
    req.end()
  })
}

async function initializeTransaction({ email, amount, currency = 'ZAR', reference, metadata = {}, callbackUrl }) {
  return paystackRequest('POST', '/transaction/initialize', {
    email,
    amount: Math.round(amount * 100),
    currency,
    reference,
    metadata,
    callback_url: callbackUrl,
  })
}

async function verifyTransaction(reference) {
  return paystackRequest('GET', `/transaction/verify/${encodeURIComponent(reference)}`)
}

function verifyWebhookSignature(body, signature) {
  const payload = typeof body === 'string' ? body : JSON.stringify(body)
  const hash = crypto.createHmac('sha512', secret()).update(payload).digest('hex')
  return hash === signature
}

module.exports = { initializeTransaction, verifyTransaction, verifyWebhookSignature }
