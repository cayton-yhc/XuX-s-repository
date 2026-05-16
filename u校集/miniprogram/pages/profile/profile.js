const app = getApp()
const { listMyGoods } = require('../../utils/api')
const { defaultAvatar } = require('../../config/index')
const { resolveDisplayUrl } = require('../../utils/file')
const { isLoggedInProfile } = require('../../utils/auth')

Page({
  data: {
    profile: {
      nickName: '',
      avatarUrl: defaultAvatar,
      signature: '',
      schoolVerifyStatus: 'unsubmitted',
      schoolVerified: false
    },
    defaultAvatar,
    stats: {
      myGoodsCount: 0
    },
    loggedIn: false,
    isAdmin: false
  },

  /** 页面展示时刷新资料、统计和 tabBar 选中态。 */
  onShow() {
    this.syncTabBar()
    this.loadProfilePage()
  },

  /** 同步自定义 tabBar 的当前选中页面。 */
  syncTabBar() {
    const tabBar = this.getTabBar && this.getTabBar()
    if (tabBar) {
      tabBar.setData({ selected: '/pages/profile/profile' })
    }
  },

  /**
   * 加载“我的”页数据。
   * 修复点：头像也走统一解析，避免 users.avatarUrl 是 cloud:// 时无法显示。
   */
  async loadProfilePage() {
    try {
      if (!app.globalData.loginReady) {
        await app.bootstrapUser()
      }
      const profile = app.globalData.userProfile || {}
      const loggedIn = isLoggedInProfile(profile)
      const [avatarUrl, myGoodsRes] = await Promise.all([
        resolveDisplayUrl(profile.avatarUrl || '', defaultAvatar),
        loggedIn ? listMyGoods() : Promise.resolve({ list: [] })
      ])

      this.setData({
        profile: {
          nickName: profile.nickName || '',
          avatarUrl: avatarUrl || defaultAvatar,
          signature: profile.signature || '',
          schoolVerifyStatus: profile.schoolVerifyStatus || 'unsubmitted',
          schoolVerified: !!profile.schoolVerified
        },
        stats: {
          myGoodsCount: (myGoodsRes.list || []).length
        },
        loggedIn,
        isAdmin: !!app.globalData.isAdmin
      })
    } catch (error) {
      console.error('我的页加载失败：', error)
      wx.showToast({ title: '加载失败', icon: 'none' })
    }
  },

  /** 进入登录与资料页。 */
  goLoginPage() {
    wx.navigateTo({ url: '/pages/login/login' })
  },

  /** 进入我的发布列表。 */
  goMyProducts() {
    wx.navigateTo({ url: '/pages/my-products/my-products' })
  },

  /** 进入学校认证页。 */
  goSchoolVerify() {
    wx.navigateTo({ url: '/pages/school-verify/school-verify' })
  },

  /** 进入管理员审核页。 */
  goAdminReview() {
    wx.navigateTo({ url: '/pages/admin-review/admin-review' })
  },

  /** 进入校园工具箱。 */
  goToolbox() {
    wx.navigateTo({ url: '/pages/toolbox/toolbox' })
  }
})
