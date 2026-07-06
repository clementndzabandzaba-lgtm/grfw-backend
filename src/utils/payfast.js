const crypto = require('crypto')

const SANDBOX      = process.env.PAYFAST_SANDBOX !== 'false'
const MERCHANT_ID  = process.env.PAYFAST_MERCHANT_ID  || '10000100'
const MERCHANT_KEY = process.env.PAYFAST_MERCHANT_KEY || '46f0cd694581a'
const PASSPHRASE   = process.env.PAYFAST_PASSPHRASE   || ''
const PAYMENT_URL  = SANDBOX
  ? 'https://sandbox.payfast.co.za/eng/process'
  : 'https://www.payfast.co.za/eng/process'

function generateSignature(data, passPhrase) {
  const paramString = Object.entries(data)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v)).replace(/%20/g, '+')}`)
    .join('&') + (passPhrase ? `&passphrase=${encodeURIComponent(passPhrase).replace(/%20/g, '+')}` : '')

  return crypto.createHash('md5').update(paramString).digest('hex')
}

/**
 * Build all PayFast payment fields including the signature.
 * Returns { fields, url } — POST `fields` to `url`.
 */
function buildPaymentData({ paymentId, name, email, amount, itemName, itemDesc, returnUrl, cancelUrl, notifyUrl, customStr1 }) {
  const nameParts = name.trim().split(/\s+/)
  const fields = {
    merchant_id:   MERCHANT_ID,
    merchant_key:  MERCHANT_KEY,
    return_url:    returnUrl,
    cancel_url:    cancelUrl,
    notify_url:    notifyUrl,
    name_first:    nameParts[0],
    name_last:     nameParts.slice(1).join(' ') || nameParts[0],
    email_address: email,
    m_payment_id:  paymentId,
    amount:        parseFloat(amount).toFixed(2),
    item_name:     itemName,
  }
  if (itemDesc)   fields.item_description = itemDesc
  if (customStr1) fields.custom_str1      = customStr1

  fields.signature = generateSignature(fields, PASSPHRASE)
  return { fields, url: PAYMENT_URL }
}

/**
 * Verify an ITN notification from PayFast.
 * Returns true if the signature is valid.
 */
function verifyItn(body) {
  const { signature, ...rest } = body
  const expected = generateSignature(rest, PASSPHRASE)
  return expected === signature
}

module.exports = { buildPaymentData, verifyItn, PAYMENT_URL }
