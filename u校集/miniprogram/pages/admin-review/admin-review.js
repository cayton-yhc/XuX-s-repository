const app = getApp()
const { listSchoolAuthRequests, reviewSchoolAuthRequest } = require('../../utils/api')
const { goBackOrSwitchTab } = require('../../utils/helper')
const { resolveDisplayUrlList } = require('../../utils/file')

Page({
  data: {
    list: [],
    isAdmin: false
  },

  /** 页面显示时判断管理员身份，管理员才拉取待审核申请。 */
  onShow() {
    const isAdmin = !!app.globalData.isAdmin
    this.setData({ isAdmin, list: isAdmin ? this.data.list : [] })
    if (isAdmin) {
      this.loadRequests()
    }
  },

  /**
   * 加载待审核申请。
   * 修复点：学生证/校园卡图片是云存储 fileID 时，先解析成临时链接再展示。
   */
  async loadRequests() {
    try {
      wx.showLoading({ title: '加载中', mask: true })
      const res = await listSchoolAuthRequests('pending')
      const rawList = res.list || []
      const cardImages = await resolveDisplayUrlList(rawList.map((item) => item.cardImage || ''), '')
      const list = rawList.map((item, index) => ({
        ...item,
        cardImage: cardImages[index] || ''
      }))
      this.setData({ list })
      wx.hideLoading()
    } catch (error) {
      wx.hideLoading()
      console.error('审核列表加载失败：', error)
      wx.showToast({ title: '加载失败', icon: 'none' })
    }
  },

  /** 预览认证图片。 */
  previewCardImage(e) {
    const src = e.currentTarget.dataset.src
    if (!src) return
    wx.previewImage({ current: src, urls: [src] })
  },

  /** 通过或驳回某条学校认证申请。 */
  review(e) {
    const id = e.currentTarget.dataset.id
    const status = e.currentTarget.dataset.status
    const label = status === 'approved' ? '通过' : '驳回'
    if (!id || !status) return
    wx.showModal({
      title: `确认${label}`,
      content: `确认要${label}这条学校认证申请吗？`,
      success: async (res) => {
        if (!res.confirm) return
        try {
          wx.showLoading({ title: '处理中', mask: true })
          await reviewSchoolAuthRequest(id, status)
          wx.hideLoading()
          wx.showToast({ title: `已${label}`, icon: 'success' })
          this.loadRequests()
        } catch (error) {
          wx.hideLoading()
          console.error('审核失败：', error)
          wx.showToast({ title: '操作失败', icon: 'none' })
        }
      }
    })
  },

  /** 返回上一页，没有上一页时回到“我的”页。 */
  goBack() {
    goBackOrSwitchTab('/pages/profile/profile')
  }
})
