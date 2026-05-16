const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

/**
 * 登录云函数。
 * 作用：获取当前微信调用上下文里的 openid / appid / unionid。
 * 原理：小程序通过 wx.cloud.callFunction 调用时，微信会自动带上可信用户身份。
 */
exports.main = async () => {
  const { OPENID, APPID, UNIONID } = cloud.getWXContext()
  return {
    openid: OPENID,
    appid: APPID,
    unionid: UNIONID || ''
  }
}
