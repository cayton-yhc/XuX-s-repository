const { envId } = require('./config/index')
const { bootstrapUserProfile, getMyProfile } = require('./utils/api')

App({
  globalData: {
    envId,
    openid: '',
    userProfile: null,
    loginReady: false,
    isAdmin: false
  },

  bootstrapPromise: null,

  /**
   * 小程序启动时初始化云环境。
   * 原理：所有云函数、云数据库、云存储、AI 能力都依赖 wx.cloud.init 初始化后的环境。
   */
  onLaunch() {
    if (!wx.cloud) {
      wx.showModal({
        title: '基础库过低',
        content: '请使用支持云开发的小程序基础库版本。',
        showCancel: false
      })
      return
    }

    wx.cloud.init({
      env: envId,
      traceUser: true
    })

    this.bootstrapUser().catch((error) => {
      console.warn('启动时初始化用户失败：', error)
    })
  },

  /**
   * 初始化当前微信用户在云数据库中的档案。
   * 修复点：用 bootstrapPromise 防止多个页面同时进入时重复调用登录云函数。
   */
  async bootstrapUser() {
    if (this.globalData.loginReady && this.globalData.userProfile) {
      return this.globalData.userProfile
    }
    if (this.bootstrapPromise) return this.bootstrapPromise

    this.bootstrapPromise = (async () => {
      const loginRes = await wx.cloud.callFunction({ name: 'login' })
      this.globalData.openid = loginRes.result.openid || ''
      const profileRes = await bootstrapUserProfile()
      this.globalData.userProfile = profileRes.user || null
      this.globalData.isAdmin = !!profileRes.isAdmin
      this.globalData.loginReady = true
      return this.globalData.userProfile
    })()

    try {
      return await this.bootstrapPromise
    } finally {
      this.bootstrapPromise = null
    }
  },

  /**
   * 主动刷新当前用户信息。
   * 作用：在“登录与资料”页修改昵称、头像、微信号后，让首页等页面同步最新信息。
   */
  async refreshUserProfile() {
    const res = await getMyProfile()
    this.globalData.userProfile = res.user || null
    this.globalData.isAdmin = !!res.isAdmin
    this.globalData.loginReady = true
    return this.globalData.userProfile
  }
})
