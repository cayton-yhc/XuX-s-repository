const app = getApp()
const { getGoodsDetail, ensureConversation } = require('../../utils/api')
const { formatFullTime } = require('../../utils/time')
const { defaultAvatar, defaultGoodsCover } = require('../../config/index')
const { goBackOrSwitchTab } = require('../../utils/helper')
const { normalizeFileRefs, resolveDisplayImages, resolveDisplayUrl } = require('../../utils/file')
const { requireLogin } = require('../../utils/auth')

/**
 * 私信错误文案转换。
 * 作用：把云函数抛出的技术错误转成用户能理解的提示。
 */
function getErrorMessage(error) {
  const raw = String((error && (error.message || error.errMsg)) || '')
  const lowered = raw.toLowerCase()
  if (!raw) return '暂时无法发起私信'
  if (lowered.includes('collection') && lowered.includes('not')) return '私信功能未部署完成，请先部署云函数'
  if (lowered.includes('permission') || raw.includes('无权限')) return '私信权限不足，请检查云开发权限配置'
  if (raw.includes('商品当前不可私信')) return '该商品当前不可私信'
  if (raw.includes('商品缺少卖家信息')) return '商品信息不完整，暂时无法私信'
  if (raw.includes('商品不存在')) return '商品不存在或已删除'
  if (raw.includes('不能给自己发私信')) return '不能私信自己发布的商品'
  return '暂时无法发起私信'
}

/**
 * 收集商品可能存在的所有图片字段。
 * 修复点：详情页不能只取第一张封面，否则会丢失相册，也可能把空字符串带进 swiper。
 */
function collectGoodsImages(goods = {}) {
  return normalizeFileRefs([
    goods.images,
    goods.imageList,
    goods.imageUrls,
    goods.pics,
    goods.photos,
    goods.gallery,
    goods.cover,
    goods.imageUrl,
    goods.image,
    goods.thumb
  ], 3)
}

/** 把标签字段统一为数组，避免历史脏数据导致 wx:for 报错。 */
function normalizeTags(tags = []) {
  return Array.isArray(tags) ? tags.filter(Boolean) : []
}

Page({
  data: {
    id: '',
    goods: null,
    loading: false,
    isOwner: false,
    canContact: false,
    defaultAvatar,
    defaultGoodsCover
  },

  /** 页面入口：保存商品 id 并加载详情。 */
  onLoad(options) {
    this.setData({ id: options.id || '' })
    this.loadDetail()
  },

  /**
   * 加载商品详情。
   * 修复点：统一解析商品图和卖家头像，过滤空图，cloud:// 转临时 HTTP，失败时走默认图。
   */
  async loadDetail() {
    if (!this.data.id) return
    this.setData({ loading: true })

    try {
      const res = await getGoodsDetail(this.data.id)
      const goods = res.detail || {}
      const rawImages = collectGoodsImages(goods)
      const rawAvatar = goods.ownerAvatarUrl || ''

      const [finalImages, realAvatar] = await Promise.all([
        resolveDisplayImages(rawImages, defaultGoodsCover),
        resolveDisplayUrl(rawAvatar, defaultAvatar)
      ])

      const myOpenid = app.globalData.openid || ''
      const isOwner = goods.ownerOpenid === myOpenid

      this.setData({
        goods: {
          ...goods,
          images: finalImages,
          tags: normalizeTags(goods.tags),
          ownerAvatarUrl: realAvatar || defaultAvatar,
          createdTime: formatFullTime(goods.createdAt)
        },
        isOwner,
        canContact: !isOwner && goods.status === 'on'
      })
    } catch (error) {
      console.error('详情加载失败：', error)
      wx.showToast({ title: '加载失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },

  /** 预览当前点击的商品图片。 */
  previewImage(e) {
    const current = e.currentTarget.dataset.src
    const urls = ((this.data.goods && this.data.goods.images) || []).filter(Boolean)
    if (!current || !urls.length) return
    wx.previewImage({ current, urls })
  },

  /** 图片加载失败时替换为默认商品图，防止轮播出现空白。 */
  onBannerImageError(e) {
    const index = Number(e.currentTarget.dataset.index)
    const goods = this.data.goods
    if (!goods || !Array.isArray(goods.images) || !Number.isInteger(index)) return
    const images = [...goods.images]
    images[index] = defaultGoodsCover
    this.setData({ 'goods.images': images })
  },

  /** 头像加载失败时替换为默认头像。 */
  onAvatarError() {
    if (!this.data.goods) return
    this.setData({ 'goods.ownerAvatarUrl': defaultAvatar })
  },

  /**
   * 联系卖家。
   * 原理：先确保会话存在，再跳转聊天页；自己发布的商品和非在售商品禁止私信。
   */
  async contactSeller() {
    const goods = this.data.goods
    if (!goods) return
    if (!(await requireLogin({
      title: '先登录再私信',
      content: '完善昵称并保存后，就可以联系卖家。',
      from: 'contact'
    }))) {
      return
    }
    if (this.data.isOwner) {
      wx.showToast({ title: '这是你自己发布的商品', icon: 'none' })
      return
    }
    if (goods.status !== 'on') {
      wx.showToast({ title: '该商品当前不可私信', icon: 'none' })
      return
    }
    try {
      wx.showLoading({ title: '正在打开会话', mask: true })
      const res = await ensureConversation(goods._id, goods.ownerOpenid || '')
      wx.hideLoading()
      if (res && res.created) {
        wx.showToast({ title: '已发送购买意向', icon: 'none' })
      }
      wx.navigateTo({ url: `/pages/chat/chat?conversationId=${res.conversationId}` })
    } catch (error) {
      wx.hideLoading()
      console.error('创建会话失败：', error)
      wx.showToast({ title: getErrorMessage(error), icon: 'none' })
    }
  },

  /** 打开卖家的公开主页。 */
  goSellerProfile() {
    const goods = this.data.goods
    if (!goods || !goods.ownerOpenid) return
    wx.navigateTo({ url: `/pages/seller/seller?openid=${goods.ownerOpenid}` })
  },

  /** 返回上一页；没有上一页时回到首页 tab。 */
  goBack() {
    goBackOrSwitchTab('/pages/home/home')
  }
})
