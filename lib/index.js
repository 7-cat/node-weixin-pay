'use strict'

/**
 * For Weixin Pay ver 3.3.7
 * @type {*|exports|module.exports}
 */

var _ = require('lodash')
var request = require('node-weixin-request')
var util = require('node-weixin-util')
var validator = require('node-form-validator')
var crypto = require('crypto')
var querystring = require('querystring')
var randomstring = require('randomstring')

var pay = {
  callback: require('./callback'),
  api: require('./api'),
  /**
   * Handler for weixin server response
   *
   * @param app
   * @param merchant
   * @param json                    Validation for data received
   * @param resultValidator         Validation for data result
   * @param cb
   * @returns {*}
   */
  handle: function(app, merchant, json, resultValidator, cb) {
    var enterprise = json.enterprise
    if (enterprise) {
      delete json.enterprise
    }
    var returnCode = json.return_code
    var returnMsg = json.return_msg
    var error = {}

    if (returnCode === 'SUCCESS') {
      if (!enterprise) {
        var vError = pay.validate(app, merchant, json)
        if (vError !== true) {
          cb(true, vError, json)
          return
        }
      }

      if (resultValidator === null) {
        cb(false, json, json)
        return
      }

      var resultCode = json.result_code
      if (resultCode === 'SUCCESS') {
        error = validator.validate(json, resultValidator)
        if (!error || error.code !== 0) {
          cb(true, error, json)
          return
        }

        var result = validator.extract(json, resultValidator)
        cb(false, result, json)

        return
      }
    }
    cb(true, json, json)
  },

  /**
   * Basic http request wrapper for pay apis, which need to be encrypted and verified for their data format
   *
   * @param url                 Requesting url
   * @param data                Data to be sent
   * @param sendConfig          Sending data validation configuration
   * @param receiveConfig       Receiving data validation configuration
   * @param certificate         Certificate from Tencent Pay
   * @param cb                  Callback Function
   */
  request: function(config, url, data, sendConfig, receiveConfig, cb) {
    data = data || {}
    const { download, file, enterprise } = data
    if (download) {
      delete data.download
    }
    if (file) {
      delete data.file
    }
    if (enterprise) {
      delete data.enterprise
    }

    var params = _.clone(data)
    if (enterprise) {
      params = pay.prepareEnterprise(config.app, config.merchant, params)
    } else {
      params = pay.prepare(config.app, config.merchant, params)
    }

    var sign = pay.sign(config.merchant, params)
    params.sign = sign

    //Validate Sending Data
    var error = validator.validate(params, sendConfig)
    if (!error || error.code !== 0) {
      cb(true, error)
      return
    }

    var xml = util.toXml(params)
    function onRequest(error, json) {
      if (json) {
        json.enterprise = true
      }
      pay.handle(config.app, config.merchant, json, receiveConfig, cb)
    }

    if (download && file) {
      request.download(url, xml, file, cb)
    } else if (config.ssl) {
      request.xmlssl(url, xml, config.certificate, onRequest)
    } else {
      request.xml(url, xml, onRequest)
    }
  },

  /**
   * Prepare data with normal fields
   *
   * @param data
   * @param app
   * @param merchant
   * @param device
   * @returns {*}
   */
  prepare: function(app, merchant, data, device) {
    if (!data.wxappid) {
      data.appid = app.id
    }
    /* eslint camelcase: [2, {properties: "never"}] */
    data.mch_id = merchant.id
    if (device) {
      data.device_info = device.info
    }
    data.nonce_str = util.getNonce()
    return data
  },

  prepareEnterprise: function(app, merchant, data, device) {
    /* eslint camelcase: [2, {properties: "never"}] */
    data.mch_appid = app.id
    data.mchid = merchant.id
    if (device) {
      data.device_info = device.info
    }
    data.nonce_str = util.getNonce()
    return data
  },

  /**
   * Sign all data with merchant key
   *
   * @param merchant
   * @param params
   * @returns {string}
   */
  sign: function(merchant, params) {
    var temp = util.marshall(params)
    temp += '&key=' + String(merchant.key)
    temp = new Buffer(temp)
    var crypt = crypto.createHash('MD5')
    crypt.update(temp)
    return crypt.digest('hex').toUpperCase()
  },

  /**
   *  Validate header for data received
   *
   * @param data
   * @param app
   * @param merchant
   * @returns {*}
   */
  validate: function(app, merchant, data) {
    if (data.wxappid) {
      return true
    }
    var config = require('./conf/validation')
    var conf = config.auth.header
    var error = validator.validate(data, conf)
    if (!error || error.code !== 0) {
      return new Error('Validation Failed!')
    }
    if (String(data.appid) !== String(app.id)) {
      return new Error('AppId Invalid!')
    }
    return true
  },

  /**
   *  Make prepay data for jssdk
   *
   * @param app
   * @param merchant
   * @param prepayId
   * @returns {{appId: *, timeStamp: string, nonceStr, package: string, signType: string}}
   */
  prepay: function(app, merchant, prepayId) {
    var crypto = require('crypto')
    var md5 = crypto.createHash('md5')
    var timeStamp = String(new Date().getTime())

    md5.update(timeStamp)
    timeStamp = Math.floor(timeStamp / 1000)

    var nonceStr = md5.digest('hex')
    var data = {
      appId: app.id,
      timeStamp: String(timeStamp),
      nonceStr: nonceStr,
      package: 'prepay_id=' + prepayId,
      signType: 'MD5'
    }
    data.paySign = pay.sign(merchant, data)
    return data
  },

  /**
   *  return QRCode String
   * @param app
   * @param merchant
   * @param productId
   * @returns {String}
   */
  qrcode: function(app, merchant, productId) {
    var params = {
      appid: app.id,
      mch_id: merchant.id,
      product_id: productId,
      time_stamp: new Date().getTime(),
      nonce_str: randomstring.generate()
    }

    var sign = pay.sign(merchant, params)
    params.sign = sign
    return 'weixin://wxpay/bizpayurl?' + querystring.stringify(params)
  }
}

module.exports = pay
