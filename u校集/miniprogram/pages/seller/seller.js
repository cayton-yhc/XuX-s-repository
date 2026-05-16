const { getUserPublicProfile, listGoodsByOwner } = require('../../utils/api')
const { defaultAvatar, defaultGoodsCover } = require('../../config/index')
const { goBackOrSwitchTab } = require('../../utils/helper')
const { resolveDisplayUrl, resolveDisplayUrlList, isTempLocalFile, uniqueStrings } = require('../../utils/file')

/** 从商品对象里取卖家页列表封面原始地址。 */
function pickCover(item = {}) {
  if (Array.isArray(item.images) && item.images.length) return item.images[0]
  return item.cover || item.imageUrl || item.image || ''
}

/** 从商品列表里回退收集卖家头像，兼容公开资料头像为空或失效的历史数据。 */
function collectGoodsOwnerAvatars(list = []) {
  const avatars = []
  for (let i = 0; i < list.length; i += 1) {
    const item = list[i] || {}
    const avatar = String(item.ownerAvatarUrl || item.avatarUrl || item.avatar || '').trim()
    if (avatar) avatars.push(avatar)
  }
  return avatars
}

/** 从卖家资料和商品快照里按优先级收集头像候选。 */
function collectSellerAvatarCandidates(profile = {}, goodsList = []) {
  return uniqueStrings([
    profile.avatarUrl,
    profile.avatar,
    profile.userInfo && profile.userInfo.avatarUrl,
    ...collectGoodsOwnerAvatars(goodsList)
  ])
}

/**
 * 解析卖家头像。
 * 重点：seller 页展示的是公开资料，不能使用 wxfile://、http://tmp/ 这类本地临时路径。
 */
async function resolveSellerAvatar(rawAvatar = '') {
  const avatar = String(rawAvatar || '').trim()

  if (!avatar || isTempLocalFile(avatar)) {
    return ''
  }

  return resolveDisplayUrl(avatar, '')
}

/** 批量解析头像候选，保留顺序用于 image 加载失败时继续兜底。 */
async function resolveSellerAvatarCandidates(rawCandidates = []) {
  const resolved = await Promise.all(rawCandidates.map((item) => resolveSellerAvatar(item)))
  return uniqueStrings(resolved).filter((item) => item && item !== defaultAvatar)
}

Page({
  data: {
    openid: '',
    profile: {},
    goodsList: [],
    avatarCandidates: [],
    avatarIndex: 0,
    defaultAvatar,
    defaultGoodsCover
  },

  /** 页面入口：记录卖家 openid 并加载卖家资料和在售商品。 */
  onLoad(options) {
    this.setData({ openid: options.openid || '' })
    this.loadSellerPage()
  },

  /**
   * 加载卖家主页。
   * 修复点：卖家头像和商品封面统一解析，避免 cloud:// 头像在卖家页不显示。
   */
  async loadSellerPage() {
    const openid = this.data.openid
    if (!openid) return
    try {
      wx.showLoading({ title: '加载中', mask: true })
      const [profileRes, goodsRes] = await Promise.all([
        getUserPublicProfile(openid),
        listGoodsByOwner(openid)
      ])
      const rawProfile = profileRes.user || {}
      const rawList = goodsRes.list || []
      const rawAvatarCandidates = collectSellerAvatarCandidates(rawProfile, rawList)

      const [avatarCandidates, covers] = await Promise.all([
        resolveSellerAvatarCandidates(rawAvatarCandidates),
        resolveDisplayUrlList(rawList.map((item) => pickCover(item)), defaultGoodsCover)
      ])
      const avatarUrl = avatarCandidates[0] || defaultAvatar
      const goodsList = rawList.map((item, index) => ({
        ...item,
        cover: covers[index] || defaultGoodsCover
      }))
      this.setData({
        profile: {
          ...rawProfile,
          avatarUrl
        },
        goodsList,
        avatarCandidates,
        avatarIndex: 0
      })
      wx.hideLoading()
    } catch (error) {
      wx.hideLoading()
      console.error('卖家主页加载失败：', error)
      wx.showToast({ title: '加载失败', icon: 'none' })
    }
  },

  /** 卖家头像加载失败时，切换成默认头像。 */
  onSellerAvatarError() {
    const nextIndex = this.data.avatarIndex + 1
    const nextAvatar = this.data.avatarCandidates[nextIndex]
    if (nextAvatar) {
      this.setData({
        'profile.avatarUrl': nextAvatar,
        avatarIndex: nextIndex
      })
      return
    }
    this.setData({
      'profile.avatarUrl': defaultAvatar
    })
  },

  /** 打开卖家的某个商品详情。 */
  goDetail(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    wx.navigateTo({ url: `/pages/detail/detail?id=${id}` })
  },

  /** 返回上一页，没有上一页时回到首页。 */
  goBack() {
    goBackOrSwitchTab('/pages/home/home')
  }
})
