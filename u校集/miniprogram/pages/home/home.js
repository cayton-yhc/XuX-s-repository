const app = getApp()
const { categories, defaultAvatar, defaultGoodsCover } = require('../../config/index')
const { listGoods } = require('../../utils/api')
const { formatRelativeTime } = require('../../utils/time')
const { resolveDisplayUrlList } = require('../../utils/file')

/** 从商品对象里取列表封面原始地址。 */
function pickCover(item = {}) {
  if (Array.isArray(item.images) && item.images.length) return item.images[0]
  return item.cover || item.imageUrl || item.image || ''
}

/** 把标签字段归一化，避免历史字符串/空值影响 wx:for。 */
function normalizeTags(tags = []) {
  return Array.isArray(tags) ? tags.filter(Boolean) : []
}

Page({
  data: {
    categories,
    activeCategory: '全部',
    keyword: '',
    greetingName: '同学',
    allGoods: [],
    goodsList: [],
    loading: false,
    refreshTip: '下拉页面可刷新最新闲置',
    defaultAvatar,
    defaultGoodsCover
  },

  /** 页面首次加载时拉取首页数据。 */
  onLoad() {
    this.loadPageData()
  },

  /** 页面展示时只同步 tabBar 和欢迎语，列表只在首次进入或用户下拉时刷新。 */
  onShow() {
    this.syncTabBar()
    this.updateGreeting()
  },

  /** 同步自定义 tabBar 的选中项。 */
  syncTabBar() {
    const tabBar = this.getTabBar && this.getTabBar()
    if (tabBar) {
      tabBar.setData({ selected: '/pages/home/home' })
    }
  },

  /** 下拉刷新首页数据。 */
  async onPullDownRefresh() {
    this.setData({ refreshTip: '正在刷新最新闲置...' })
    try {
      await this.loadPageData(false)
      this.setData({ refreshTip: '刷新完成，已更新最新闲置' })
      wx.showToast({ title: '已刷新', icon: 'success' })
    } finally {
      wx.stopPullDownRefresh()
    }
  },

  /** 首页主加载函数：先刷新欢迎语，再刷新商品列表。 */
  async loadPageData(showLoading = true) {
    this.updateGreeting()
    await this.loadGoods(showLoading)
  },

  /** 根据全局用户资料生成顶部欢迎语。 */
  updateGreeting() {
    const profile = app.globalData.userProfile || {}
    this.setData({ greetingName: profile.nickName || '同学' })
  },

  /**
   * 从云函数获取商品列表。
   * 修复点：封面和头像都走统一解析，cloud://、HTTP、静态默认图都能正确展示。
   */
  async loadGoods(showLoading = true) {
    if (showLoading) this.setData({ loading: true })
    try {
      const res = await listGoods()
      const rawList = res.list || []
      const coverRefs = rawList.map((item) => pickCover(item))
      const avatarRefs = rawList.map((item) => item.ownerAvatarUrl || '')
      const [covers, avatars] = await Promise.all([
        resolveDisplayUrlList(coverRefs, defaultGoodsCover),
        resolveDisplayUrlList(avatarRefs, defaultAvatar)
      ])

      const allGoods = rawList.map((item, index) => ({
        ...item,
        tags: normalizeTags(item.tags),
        cover: covers[index] || defaultGoodsCover,
        ownerAvatarUrl: avatars[index] || defaultAvatar,
        timeText: formatRelativeTime(item.createdAt)
      }))

      this.setData({ allGoods })
      this.applyFilters()
    } catch (error) {
      console.error('首页商品加载失败：', error)
      wx.showToast({ title: '加载失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },

  /** 搜索框实时输入：只做本地筛选，不重复请求云函数。 */
  onSearchInput(e) {
    this.setData({ keyword: e.detail.value || '' })
    this.applyFilters()
  },

  /** 清空搜索关键字并恢复列表。 */
  clearSearch() {
    this.setData({ keyword: '' })
    this.applyFilters()
  },

  /** 切换分类标签。 */
  onSelectCategory(e) {
    const category = e.currentTarget.dataset.category
    this.setData({ activeCategory: category })
    this.applyFilters()
  },

  /** 本地过滤商品：按分类和关键词匹配标题、分类、标签、描述。 */
  applyFilters() {
    const { allGoods, activeCategory, keyword } = this.data
    const loweredKeyword = String(keyword || '').trim().toLowerCase()
    const goodsList = allGoods.filter((item) => {
      const categoryPass = activeCategory === '全部' || item.category === activeCategory
      if (!categoryPass) return false
      if (!loweredKeyword) return true
      const haystack = [
        item.title,
        item.category,
        ...(item.tags || []),
        item.description
      ].join(' ').toLowerCase()
      return haystack.includes(loweredKeyword)
    })
    this.setData({ goodsList })
  },

  /** 跳转到商品详情页。 */
  goDetail(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    wx.navigateTo({ url: `/pages/detail/detail?id=${id}` })
  }
})
