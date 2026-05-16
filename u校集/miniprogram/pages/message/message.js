const { listConversations } = require('../../utils/api')
const { formatRelativeTime } = require('../../utils/time')
const { defaultAvatar, defaultGoodsCover } = require('../../config/index')
const { resolveDisplayUrlList } = require('../../utils/file')
const { requireLogin, buildLoginUrl } = require('../../utils/auth')

Page({
  data: {
    conversations: [],
    loading: false,
    loginChecked: false,
    canUseMessage: false,
    defaultAvatar,
    defaultGoodsCover
  },

  /** 首次进入页面时等待 onShow 统一校验登录并加载会话。 */
  onLoad() {},

  /** 每次展示页面时刷新会话列表和 tabBar。 */
  async onShow() {
    this.syncTabBar()
    const canUseMessage = await this.ensureMessageLogin(true)
    if (canUseMessage) {
      this.loadConversations(false)
    }
  },

  /** 同步自定义 tabBar 的当前选中页面。 */
  syncTabBar() {
    const tabBar = this.getTabBar && this.getTabBar()
    if (tabBar) {
      tabBar.setData({ selected: '/pages/message/message' })
    }
  },

  async ensureMessageLogin(showModal = true) {
    const canUseMessage = await requireLogin({
      title: '先登录再查看私信',
      content: '完善昵称并保存后，就可以查看和发送私信。',
      from: 'message',
      silent: !showModal
    })
    this.setData({
      loginChecked: true,
      canUseMessage
    })
    return canUseMessage
  },

  goLoginPage() {
    wx.navigateTo({ url: buildLoginUrl('message') })
  },

  /**
   * 拉取当前用户的全部会话。
   * 修复点：会话封面和对方头像统一解析，避免 cloud:// 直接进入 image 组件。
   */
  async loadConversations(showLoading = true) {
    if (!this.data.canUseMessage) return
    if (showLoading) this.setData({ loading: true })
    try {
      const res = await listConversations()
      const rawList = res.list || []
      const coverRefs = rawList.map((item) => item && item.goodsSnapshot ? item.goodsSnapshot.cover : '')
      const avatarRefs = rawList.map((item) => item && item.otherUser ? item.otherUser.avatarUrl : '')
      const [covers, avatars] = await Promise.all([
        resolveDisplayUrlList(coverRefs, defaultGoodsCover),
        resolveDisplayUrlList(avatarRefs, defaultAvatar)
      ])

      const conversations = rawList.map((item, index) => ({
        ...item,
        displayTime: formatRelativeTime(item.lastMessageAt),
        otherAvatar: avatars[index] || defaultAvatar,
        goodsCover: covers[index] || defaultGoodsCover
      }))
      this.setData({ conversations })
    } catch (error) {
      console.error('会话列表获取失败：', error)
      wx.showToast({ title: '私信加载失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },

  /** 打开某个会话。 */
  openConversation(e) {
    if (!this.data.canUseMessage) return
    const conversationId = e.currentTarget.dataset.id
    if (!conversationId) return
    wx.navigateTo({ url: `/pages/chat/chat?conversationId=${conversationId}` })
  }
})
