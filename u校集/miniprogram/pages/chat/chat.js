const app = getApp()
const { listMessages, sendMessage } = require('../../utils/api')
const { formatFullTime } = require('../../utils/time')
const { defaultAvatar, defaultGoodsCover } = require('../../config/index')
const { goBackOrSwitchTab } = require('../../utils/helper')
const { resolveDisplayUrl } = require('../../utils/file')
const { requireLogin } = require('../../utils/auth')

const SHOW_COMPOSER_SCROLL_DISTANCE = 56
const HIDE_COMPOSER_SCROLL_DISTANCE = 96

/** 判断轮询回来的消息是否真的发生变化，避免无变化时反复 setData。 */
function isSameMessageList(prev = [], next = []) {
  if (prev.length !== next.length) return false
  for (let i = 0; i < prev.length; i += 1) {
    const oldItem = prev[i] || {}
    const nextItem = next[i] || {}
    if (
      oldItem._id !== nextItem._id ||
      oldItem.content !== nextItem.content ||
      oldItem.fromOpenid !== nextItem.fromOpenid
    ) {
      return false
    }
  }
  return true
}

function getAvatarSource(user = {}) {
  return String(user.avatarSourceUrl || user.avatarUrl || '').trim()
}

Page({
  data: {
    conversationId: '',
    conversation: null,
    goodsSnapshot: null,
    otherUser: null,
    messages: [],
    inputValue: '',
    loading: false,
    sending: false,
    scrollIntoView: '',
    scrollWithAnimation: true,
    composerVisible: true,
    defaultAvatar,
    defaultGoodsCover
  },

  timer: null,
  fetching: false,
  avatarCache: {
    source: '',
    displayUrl: ''
  },
  scrollState: {
    ready: false,
    lastTop: 0,
    downDistance: 0,
    upDistance: 0
  },

  /** 页面入口：记录会话 id 并拉取首屏消息。 */
  async onLoad(options) {
    this.setData({ conversationId: options.conversationId || '' })
    if (await requireLogin({
      title: '先登录再聊天',
      content: '完善昵称并保存后，就可以继续私信沟通。',
      from: 'chat'
    })) {
      this.loadMessages()
    }
  },

  /** 页面显示时启动轮询，保持聊天内容更新。 */
  onShow() {
    this.startPolling()
  },

  /** 页面隐藏时停止轮询，避免后台持续请求。 */
  onHide() {
    this.stopPolling()
  },

  /** 页面卸载时清理轮询。 */
  onUnload() {
    this.stopPolling()
  },

  /** 启动聊天轮询。 */
  startPolling() {
    this.stopPolling()
    this.timer = setInterval(() => {
      this.loadMessages(false)
    }, 3000)
  },

  /** 停止聊天轮询。 */
  stopPolling() {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  },

  /**
   * 拉取聊天记录。
   * 修复点：商品快照封面和对方头像统一解析，防止 cloud:// 或空值造成图片不显示。
   */
  async loadMessages(showLoading = true, options = {}) {
    const conversationId = this.data.conversationId
    if (!conversationId || this.fetching) return
    this.fetching = true
    const forceBottom = !!options.forceBottom || showLoading
    if (showLoading) this.setData({ loading: true })
    try {
      const res = await listMessages(conversationId)
      const myOpenid = app.globalData.openid || ''
      const messages = (res.messages || []).map((item) => ({
        ...item,
        isMine: item.fromOpenid === myOpenid,
        timeText: formatFullTime(item.createdAt)
      }))
      const rawCover = res.conversation && res.conversation.goodsSnapshot
        ? res.conversation.goodsSnapshot.cover
        : ''
      const [cover, avatarUrl] = await Promise.all([
        resolveDisplayUrl(rawCover, defaultGoodsCover),
        this.resolveStableOtherAvatar(res.otherUser || {})
      ])
      const goodsSnapshot = res.conversation && res.conversation.goodsSnapshot
        ? {
            ...res.conversation.goodsSnapshot,
            cover: cover || defaultGoodsCover
          }
        : null
      const otherUser = res.otherUser
        ? {
            ...res.otherUser,
            avatarUrl: avatarUrl || defaultAvatar
          }
        : null

      const messagesChanged = !isSameMessageList(this.data.messages, messages)
      const nextData = {
        conversation: res.conversation || null,
        goodsSnapshot,
        otherUser
      }
      if (messagesChanged || showLoading) {
        nextData.messages = messages
      }

      this.setData(nextData)

      if (forceBottom || (messagesChanged && this.data.composerVisible)) {
        this.scrollToBottom(!showLoading)
      }
    } catch (error) {
      console.error('聊天记录拉取失败：', error)
    } finally {
      this.fetching = false
      this.setData({ loading: false })
    }
  },

  /** 对方头像在轮询中复用同一展示地址，避免临时链接变化造成闪烁。 */
  async resolveStableOtherAvatar(rawOtherUser = {}) {
    const source = getAvatarSource(rawOtherUser)
    const currentAvatar = this.data.otherUser && this.data.otherUser.avatarUrl
    const currentSource = this.avatarCache.source || getAvatarSource(this.data.otherUser || {})

    if (source && source === currentSource && this.avatarCache.displayUrl) {
      return this.avatarCache.displayUrl
    }

    if (!rawOtherUser.avatarSourceUrl && currentAvatar && currentAvatar !== defaultAvatar) {
      this.avatarCache = {
        source: source || currentSource,
        displayUrl: currentAvatar
      }
      return currentAvatar
    }

    const displayUrl = await resolveDisplayUrl(rawOtherUser.avatarUrl || source, defaultAvatar)
    this.avatarCache = {
      source,
      displayUrl: displayUrl || defaultAvatar
    }
    return this.avatarCache.displayUrl
  },

  /** 滚到聊天底部；发送消息后固定调用，保证回到最新消息。 */
  scrollToBottom(animated = true) {
    this.showComposer()
    this.setData({
      scrollIntoView: '',
      scrollWithAnimation: false
    })
    wx.nextTick(() => {
      this.setData({
        scrollIntoView: 'chat-bottom',
        scrollWithAnimation: animated
      })
    })
  },

  showComposer() {
    this.scrollState.downDistance = 0
    if (!this.data.composerVisible) {
      this.setData({ composerVisible: true })
    }
  },

  hideComposer() {
    this.scrollState.upDistance = 0
    if (this.data.composerVisible && !String(this.data.inputValue || '').trim()) {
      this.setData({ composerVisible: false })
    }
  },

  /** 阅读历史消息时收起输入栏，向下滑动一段距离后自动弹出输入栏。 */
  onMessageScroll(e) {
    const scrollTop = Number((e.detail && e.detail.scrollTop) || 0)
    const state = this.scrollState
    if (!state.ready) {
      state.ready = true
      state.lastTop = scrollTop
      return
    }

    const delta = scrollTop - state.lastTop
    state.lastTop = scrollTop
    if (Math.abs(delta) < 2) return

    if (delta > 0) {
      state.downDistance += delta
      state.upDistance = 0
      if (state.downDistance >= SHOW_COMPOSER_SCROLL_DISTANCE) {
        this.showComposer()
      }
      return
    }

    state.upDistance += Math.abs(delta)
    state.downDistance = 0
    if (state.upDistance >= HIDE_COMPOSER_SCROLL_DISTANCE) {
      this.hideComposer()
    }
  },

  onMessageScrollToLower() {
    this.showComposer()
  },

  onOtherAvatarError() {
    this.avatarCache.displayUrl = defaultAvatar
    this.setData({ 'otherUser.avatarUrl': defaultAvatar })
  },

  /** 输入框内容变化。 */
  onInput(e) {
    this.setData({ inputValue: e.detail.value || '' })
  },

  /** 复制文本到剪贴板，供消息和微信号复用。 */
  copyText(content = '', successTitle = '已复制') {
    const text = String(content || '').trim()
    if (!text) {
      wx.showToast({ title: '暂无可复制内容', icon: 'none' })
      return
    }
    wx.setClipboardData({
      data: text,
      success: () => {
        wx.showToast({ title: successTitle, icon: 'none' })
      },
      fail: () => {
        wx.showToast({ title: '复制失败', icon: 'none' })
      }
    })
  },

  /** 长按消息时复制消息内容。 */
  copyMessage(e) {
    const content = e.currentTarget.dataset.content
    this.copyText(content, '消息已复制')
  },

  /** 发送输入框里的文字消息。 */
  async onSend() {
    const { inputValue, conversationId, sending } = this.data
    const content = String(inputValue || '').trim()
    if (!content || sending) return
    if (!(await requireLogin({
      title: '先登录再聊天',
      content: '完善昵称并保存后，就可以继续私信沟通。',
      from: 'chat'
    }))) {
      return
    }
    this.setData({ sending: true, composerVisible: true })
    try {
      await sendMessage(conversationId, content)
      this.setData({ inputValue: '' })
      await this.loadMessages(false, { forceBottom: true })
    } catch (error) {
      console.error('发送消息失败：', error)
      wx.showToast({ title: '发送失败', icon: 'none' })
    } finally {
      this.setData({ sending: false })
    }
  },

  /** 快捷发送自己的微信号。 */
  async sendMyWechatNumber() {
    const myWechatNumber = app.globalData.userProfile && app.globalData.userProfile.wechatNumber
    if (!myWechatNumber) {
      wx.showModal({
        title: '还没填写微信号',
        content: '请先到“登录与资料”页填写自己的联系微信号，再回来发送给对方。',
        success: (res) => {
          if (res.confirm) {
            wx.navigateTo({ url: '/pages/login/login' })
          }
        }
      })
      return
    }
    this.setData({ inputValue: `我的微信号是：${myWechatNumber}` })
    await this.onSend()
  },

  /** 打开当前会话关联的商品详情。 */
  openGoodsDetail() {
    const goodsId = this.data.conversation && this.data.conversation.goodsId
    if (!goodsId) return
    wx.navigateTo({ url: `/pages/detail/detail?id=${goodsId}` })
  },

  /** 返回上一页，没有上一页时回到“我的”页。 */
  goBack() {
    goBackOrSwitchTab('/pages/profile/profile')
  }
})
