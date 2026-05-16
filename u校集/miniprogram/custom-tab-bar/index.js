/**
 * 自定义 tabBar。
 * 作用：统一管理四个主入口：首页 / 发布 / 私信 / 我的。
 */
const { requireLogin, isLoggedInProfile } = require('../utils/auth')

Component({
  data: {
    selected: '',
    unreadCount: 0,
    loadingUnread: false,
    tabs: [
      {
        text: '首页',
        pagePath: '/pages/home/home',
        iconPath: '/images/tabbar/home.png',
        selectedIconPath: '/images/tabbar/home-active.png'
      },
      {
        text: '发布',
        pagePath: '/pages/publish/publish',
        iconPath: '/images/tabbar/publish.png',
        selectedIconPath: '/images/tabbar/publish-active.png'
      },
      {
        text: '私信',
        pagePath: '/pages/message/message',
        iconPath: '/images/tabbar/message.png',
        selectedIconPath: '/images/tabbar/message-active.png'
      },
      {
        text: '我的',
        pagePath: '/pages/profile/profile',
        iconPath: '/images/tabbar/profile.png',
        selectedIconPath: '/images/tabbar/profile-active.png'
      }
    ]
  },

  pageLifetimes: {
    /**
     * 每次页面显示时自动同步选中状态。
     * 原理：直接读取当前页面路由，不需要每个 tab 页面手动 setData。
     */
    show() {
      const pages = getCurrentPages()
      const current = pages.length ? `/${pages[pages.length - 1].route}` : ''
      this.setData({ selected: current })
      this.refreshUnreadCount()
    }
  },

  methods: {
    /**
     * 切换 tab 页面。
     * 作用：封装统一跳转逻辑，避免重复点击当前 tab 时多余跳转。
     */
    async switchTab(e) {
      const path = e.currentTarget.dataset.path
      if (!path || path === this.data.selected) return
      if (path === '/pages/publish/publish') {
        const ok = await requireLogin({
          title: '先登录再发布',
          content: '完善昵称并保存后，就可以发布校园闲置。',
          from: 'publish'
        })
        if (!ok) return
      }
      if (path === '/pages/message/message') {
        const ok = await requireLogin({
          title: '先登录再查看私信',
          content: '完善昵称并保存后，就可以查看和发送私信。',
          from: 'message'
        })
        if (!ok) return
      }
      wx.switchTab({ url: path })
    },

    /**
     * 刷新未读数。
     * 原理：调用会话列表云函数后汇总当前用户 unreadCount，并展示在私信 tab 上。
     */
    async refreshUnreadCount() {
      if (this.data.loadingUnread || !wx.cloud) return
      const app = getApp()
      if (!isLoggedInProfile(app.globalData.userProfile || {})) {
        this.setData({ unreadCount: 0 })
        return
      }
      this.setData({ loadingUnread: true })
      try {
        const res = await wx.cloud.callFunction({
          name: 'messageManager',
          data: { action: 'listConversations' }
        })
        const list = (res && res.result && res.result.list) || []
        const unreadCount = list.reduce((sum, item) => sum + Number(item.unreadCount || 0), 0)
        this.setData({ unreadCount })
      } catch (error) {
        // 自定义 tabBar 的未读刷新不阻塞主流程，失败时静默处理即可
      } finally {
        this.setData({ loadingUnread: false })
      }
    }
  }
})
