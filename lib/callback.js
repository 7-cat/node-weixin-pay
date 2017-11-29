const xml2js = require('xml2js')
const validation = require('./conf/validation')
const crypto = require('crypto')

function onRes(res, error, cb) {
  cb()
  res.set('Content-Type', 'text/xml')
  let xml = ''
  if (error) {
    xml =
      '<xml><return_code><![CDATA[FAIL]]></return_code><return_msg><![CDATA[' +
      error +
      ']]></return_msg></xml>'
  } else {
    xml =
      '<xml><return_code><![CDATA[SUCCESS]]></return_code><return_msg><![CDATA[OK]]></return_msg></xml>'
  }
  console.log('send xml', xml)

  res.send(xml)
}

function decrypt(req_info, key, cb) {
  const md5 = crypto.createHash('md5')
  md5.update(key, 'utf8')
  const aesDec = crypto.createDecipheriv(
    'aes-256-ecb',
    new Buffer(md5.digest('hex')),
    ''
  ) // always use createDecipheriv when the key is passed as raw bytes
  const output = aesDec.update(new Buffer(req_info, 'base64'))
  const finalResult = output + aesDec.final()
  xml2js.parseString(
    finalResult,
    {
      explicitArray: false,
      ignoreAttrs: true
    },
    function(error, json) {
      if (error || !json || !json.root) {
        return cb(true, new Error(finalResult))
      }

      cb(false, json.root)
    }
  )
}

module.exports = {
  /**
   * Weixin Server Notification Handler
   *
   * @param app           app configuration
   * @param merchant      merchant configuration
   * @param req           http.req object
   * @param res           http.res object
   * @param cb            Callback function
   */
  notify: function(app, merchant, req, res, cb) {
    let xmlIn = req.body || req.rawBody
    xml2js.parseString(
      xmlIn,
      {
        explicitArray: false,
        ignoreAttrs: true
      },
      function(error, json) {
        if (error) {
          return cb(true, new Error(xmlIn))
        }

        // Should not be moved out side of this function
        let pay = require('../')
        pay.handle(app, merchant, json.xml, validation.notify, function(
          error,
          result
        ) {
          onRes(res, error, function() {
            if (cb) {
              cb(error, result, json)
            }
          })
        })
      }
    )
  },

  refundNotify: function(app, merchant, req, res, cb) {
    let xmlIn = req.body || req.rawBody
    xml2js.parseString(
      xmlIn,
      {
        explicitArray: false,
        ignoreAttrs: true
      },
      function(error, json) {
        if (error) {
          return cb(true, new Error(xmlIn))
        }

        if (!json || !json.xml || !json.xml.req_info) {
          return cb(true, new Error(xmlIn))
        }

        decrypt(json.xml.req_info, merchant.key, function(
          error,
          decryptedJson
        ) {
          if (error) {
            return cb(true, new Error(xmlIn))
          }

          decryptedJson.return_code = json.xml.return_code
          decryptedJson.appid = json.xml.appid
          decryptedJson.mch_id = json.xml.mch_id
          decryptedJson.nonce_str = json.xml.nonce_str

          if (decryptedJson.SUCCESS === 'SUCCESS') {
            return cb(true, decryptedJson, decryptedJson)
          }

          return cb(false, decryptedJson, decryptedJson)
        })
      }
    )
  }
}
