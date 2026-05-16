const { defaultGoodsCover, defaultAvatar } = require('../config/index')
const { isCloudFileId, resolveDisplayUrl, resolveDisplayUrlList, resolveDisplayImages } = require('./file')

/**
 * 媒体展示工具。
 * 说明：保留这个文件是为了兼容早期页面引用，内部统一委托给 utils/file.js 的新解析逻辑。
 */

/** 选择第一张可用商品图，没有时返回默认封面。 */
function pickFirstValidImage(images = [], fallback = defaultGoodsCover) {
  if (Array.isArray(images) && images.length) {
    return images[0] || fallback
  }
  return fallback
}

/** 批量解析云文件或普通图片地址，返回与入参数组等长的结果。 */
async function resolveCloudFiles(fileList = [], fallback = '') {
  return resolveDisplayUrlList(fileList, fallback)
}

/** 标准化商品列表的封面和头像字段。 */
async function normalizeGoodsList(list = []) {
  const source = Array.isArray(list) ? list : []
  const coversToResolve = source.map((item) => pickFirstValidImage(item.images, defaultGoodsCover))
  const avatarsToResolve = source.map((item) => item.ownerAvatarUrl || defaultAvatar)

  const [resolvedCovers, resolvedAvatars] = await Promise.all([
    resolveDisplayUrlList(coversToResolve, defaultGoodsCover),
    resolveDisplayUrlList(avatarsToResolve, defaultAvatar)
  ])

  return source.map((item, index) => ({
    ...item,
    cover: resolvedCovers[index] || defaultGoodsCover,
    ownerAvatarUrl: resolvedAvatars[index] || defaultAvatar
  }))
}

/** 标准化详情页的相册和头像字段。 */
async function normalizeGoodsDetail(goods = {}) {
  const [images, ownerAvatarUrl] = await Promise.all([
    resolveDisplayImages(Array.isArray(goods.images) && goods.images.length ? goods.images : [defaultGoodsCover], defaultGoodsCover),
    resolveDisplayUrl(goods.ownerAvatarUrl || defaultAvatar, defaultAvatar)
  ])
  return {
    ...goods,
    images,
    ownerAvatarUrl
  }
}

/** 标准化会话列表中的对方头像和商品封面。 */
async function normalizeConversationList(list = []) {
  const source = Array.isArray(list) ? list : []
  const avatarsToResolve = source.map((item) => (item.otherUser && item.otherUser.avatarUrl) || defaultAvatar)
  const coversToResolve = source.map((item) => (item.goodsSnapshot && item.goodsSnapshot.cover) || defaultGoodsCover)

  const [avatars, covers] = await Promise.all([
    resolveDisplayUrlList(avatarsToResolve, defaultAvatar),
    resolveDisplayUrlList(coversToResolve, defaultGoodsCover)
  ])

  return source.map((item, index) => ({
    ...item,
    otherAvatar: avatars[index] || defaultAvatar,
    goodsCover: covers[index] || defaultGoodsCover
  }))
}

module.exports = {
  isCloudFileId,
  pickFirstValidImage,
  resolveCloudFiles,
  normalizeGoodsList,
  normalizeGoodsDetail,
  normalizeConversationList
}
