const { listMyGoods, updateGoodsStatus, deleteMyGoods } = require('../../utils/api')
const { formatRelativeTime } = require('../../utils/time')
const { defaultGoodsCover } = require('../../config/index')
const { goBackOrSwitchTab } = require('../../utils/helper')
const { resolveDisplayUrlList } = require('../../utils/file')

/** 获取我的发布列表里的封面原始地址。 */
function pickCover(item = {}) {
  if (Array.isArray(item.images) && item.images.length) return item.images[0]
  return item.cover || item.imageUrl || item.image || ''
}

Page({
  data: {
    list: [],
    loading: false,
    defaultGoodsCover
  },

  /** 首次进入页面时加载我的发布。 */
  onLoad() {
    this.loadMyGoods()
  },

  /** 每次回到页面时刷新状态，保证上下架/删除后列表最新。 */
  onShow() {
    this.loadMyGoods(false)
  },

  /** 拉取我发布的商品，并解析封面地址。 */
  async loadMyGoods(showLoading = true) {
    if (showLoading) this.setData({ loading: true })
    try {
      const res = await listMyGoods()
      const rawList = res.list || []
      const covers = await resolveDisplayUrlList(rawList.map((item) => pickCover(item)), defaultGoodsCover)
      const list = rawList.map((item, index) => ({
        ...item,
        cover: covers[index] || defaultGoodsCover,
        timeText: formatRelativeTime(item.createdAt)
      }))
      this.setData({ list })
    } catch (error) {
      console.error('我的发布加载失败：', error)
      wx.showToast({ title: '加载失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },

  /** 打开商品详情。 */
  goDetail(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    wx.navigateTo({ url: `/pages/detail/detail?id=${id}` })
  },

  /** 在“在售”和“已售”之间切换商品状态。 */
  async toggleStatus(e) {
    const { id, status } = e.currentTarget.dataset
    const nextStatus = status === 'on' ? 'sold' : 'on'
    try {
      wx.showLoading({ title: '处理中', mask: true })
      await updateGoodsStatus(id, nextStatus)
      wx.hideLoading()
      wx.showToast({ title: nextStatus === 'on' ? '已重新上架' : '已标记已售', icon: 'success' })
      this.loadMyGoods(false)
    } catch (error) {
      wx.hideLoading()
      console.error('更新状态失败：', error)
      wx.showToast({ title: '操作失败', icon: 'none' })
    }
  },

  /** 删除商品，同时云函数会清理相关会话和消息。 */
  deleteGoods(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    wx.showModal({
      title: '确认删除',
      content: '删除后商品、相关会话和消息都会一起移除，且无法恢复。',
      confirmColor: '#c85735',
      success: async (res) => {
        if (!res.confirm) return
        try {
          wx.showLoading({ title: '删除中', mask: true })
          await deleteMyGoods(id)
          wx.hideLoading()
          wx.showToast({ title: '已删除', icon: 'success' })
          this.loadMyGoods(false)
        } catch (error) {
          wx.hideLoading()
          console.error('删除商品失败：', error)
          wx.showToast({ title: '删除失败', icon: 'none' })
        }
      }
    })
  },

  /** 返回上一页，没有上一页时回到“我的”页。 */
  goBack() {
    goBackOrSwitchTab('/pages/profile/profile')
  }
})
