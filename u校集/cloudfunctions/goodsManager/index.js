/**
 * 商品管理云函数。
 * 作用：负责商品发布、列表、详情、上下架、删除，以及历史字段兼容和图片临时链接转换。
 */
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const VALID_GOODS_STATUS = ['on', 'sold', 'off']
const MAX_TITLE_LENGTH = 40
const MAX_DESCRIPTION_LENGTH = 300
const MAX_TAG_LENGTH = 12
const MAX_TAG_COUNT = 5
const MAX_IMAGE_COUNT = 3
const TEMP_URL_BATCH_SIZE = 50
const MAX_GOODS_QUERY_LIMIT = 200
const LEGACY_CATEGORY_MAP = {
  书籍教材: '教材资料',
  宿舍好物: '生活日用',
  运动器材: '文体乐器',
  美妆个护: '生活日用',
  票券卡券: '票券服务',
  乐器文娱: '文体乐器'
}

/** 判断字符串是否为云存储 fileID。 */
function isCloudFileId(value = '') {
  return typeof value === 'string' && value.startsWith('cloud://')
}

/** 判断字符串是否为 HTTP/HTTPS 图片地址。 */
function isHttpUrl(value = '') {
  return /^https?:\/\//.test(String(value || '').trim())
}

/** 判断字符串是否为小程序本地临时文件，这类地址不能作为公开头像展示。 */
function isTempLocalFile(value = '') {
  const text = String(value || '').trim()
  return text.startsWith('wxfile://') ||
    /^https?:\/\/tmp\//.test(text) ||
    /^https?:\/\/usr\//.test(text) ||
    text.startsWith('tmp/') ||
    text.startsWith('/tmp/') ||
    text.includes('/tmp_') ||
    text.includes('/tmp/')
}

/** 从多个头像来源里选择可公开展示的候选，避免本地临时头像覆盖历史快照。 */
function pickPublicAvatarRef(...values) {
  for (let i = 0; i < values.length; i += 1) {
    const text = String(values[i] || '').trim()
    if (text && !isTempLocalFile(text)) return text
  }
  return ''
}

/** 判断图片引用是否为后端允许保存的格式。 */
function isValidImageRef(value = '') {
  return isCloudFileId(value) || isHttpUrl(value)
}

/** 获取当前调用人的微信上下文。 */
function getContext() {
  return cloud.getWXContext()
}

/** 获取用户资料，用于冻结到商品卡片里。 */
async function getUser(openid) {
  try {
    const res = await db.collection('users').doc(openid).get()
    return res.data
  } catch (error) {
    return null
  }
}

/** 读取单个商品。 */
async function getGoodsDoc(goodsId) {
  if (!goodsId) {
    throw new Error('商品不存在')
  }
  const res = await db.collection('goods').doc(goodsId).get()
  return res.data
}

/** 清理文本字段并限制最大长度。 */
function toSafeText(value, maxLength = 100) {
  return String(value || '').trim().slice(0, maxLength)
}

/** 兼容旧分类名称，统一映射到当前分类体系。 */
function normalizeCategoryName(value) {
  const category = toSafeText(value, 20)
  return LEGACY_CATEGORY_MAP[category] || category
}

/** 统一商品状态，兼容中文历史状态值。 */
function normalizeGoodsStatus(status) {
  const text = String(status || '').trim()
  if (!text) return 'on'
  if (VALID_GOODS_STATUS.includes(text)) return text
  if (['已售', '售出', 'sold'].includes(text)) return 'sold'
  if (['下架', 'off'].includes(text)) return 'off'
  return 'on'
}

/** 从字符串或常见文件对象中抽取图片引用。 */
function extractImageRef(source) {
  if (!source) return ''
  if (typeof source === 'string') return source.trim()
  if (typeof source !== 'object') return ''
  const candidate = source.fileID ||
    source.fileId ||
    source.cloudPath ||
    source.tempFileURL ||
    source.tempFilePath ||
    source.url ||
    source.src ||
    source.path ||
    source.image ||
    source.imageUrl
  return String(candidate || '').trim()
}

/** 过滤、去重并限制商品图片数量。 */
function normalizeImageList(images) {
  const list = Array.isArray(images) ? images : [images]
  const dedup = []
  const seen = new Set()
  for (let i = 0; i < list.length; i += 1) {
    const ref = extractImageRef(list[i])
    if (!isValidImageRef(ref) || seen.has(ref)) continue
    seen.add(ref)
    dedup.push(ref)
    if (dedup.length >= MAX_IMAGE_COUNT) break
  }
  return dedup
}

/** 比较两个字符串数组是否完全一致，用于判断是否需要回填历史字段。 */
function isSameStringArray(a = [], b = []) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) {
    if (String(a[i] || '') !== String(b[i] || '')) return false
  }
  return true
}

/** 汇总商品上可能存在的所有历史图片字段。 */
function resolveGoodsImages(item = {}) {
  const candidates = []
  const pushMany = (value) => {
    if (value === undefined || value === null || value === '') return
    if (Array.isArray(value)) {
      candidates.push(...value)
      return
    }
    candidates.push(value)
  }

  pushMany(item.images)
  pushMany(item.imageList)
  pushMany(item.imageUrls)
  pushMany(item.pics)
  pushMany(item.photos)
  pushMany(item.gallery)
  pushMany(item.image)
  pushMany(item.imageUrl)
  pushMany(item.cover)
  pushMany(item.thumb)

  return normalizeImageList(candidates)
}

/** 获取商品发布者 openid，兼容旧数据的 _openid。 */
function getOwnerOpenid(item = {}) {
  return String(item.ownerOpenid || item._openid || '').trim()
}

/** 合并多次查询结果，并按发布时间倒序去重。 */
function mergeGoodsList(...lists) {
  const dedup = new Map()
  lists.flat().forEach((item) => {
    if (!item || !item._id || dedup.has(item._id)) return
    dedup.set(item._id, item)
  })
  return Array.from(dedup.values()).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
}

/** 按指定字段查询商品，失败时返回空数组以兼容旧索引。 */
async function queryGoodsByField(field, value, limit = 100) {
  try {
    return await db.collection('goods')
      .where({ [field]: value })
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .get()
  } catch (error) {
    return { data: [] }
  }
}

/** 把兼容处理后的字段回填到商品文档，失败不影响主流程。 */
async function syncGoodsLegacyFields(goodsId, data = {}) {
  const payload = { ...data }
  if (!Object.keys(payload).length) return
  if (payload.updatedAt === undefined) {
    payload.updatedAt = new Date()
  }
  try {
    await db.collection('goods').doc(goodsId).update({ data: payload })
  } catch (error) {
    // 忽略历史数据回填失败，不影响主流程
  }
}

/** 从历史会话快照中补回缺失的商品封面。 */
async function getConversationCoverByGoodsId(goodsId) {
  if (!goodsId) return ''
  try {
    const res = await db.collection('conversations')
      .where({ goodsId })
      .orderBy('updatedAt', 'desc')
      .limit(1)
      .get()
    const one = (res.data || [])[0] || {}
    const cover = normalizeImageList(one.goodsSnapshot && one.goodsSnapshot.cover)
    return cover[0] || ''
  } catch (error) {
    try {
      const res = await db.collection('conversations')
        .where({ goodsId })
        .limit(1)
        .get()
      const one = (res.data || [])[0] || {}
      const cover = normalizeImageList(one.goodsSnapshot && one.goodsSnapshot.cover)
      return cover[0] || ''
    } catch (innerError) {
      return ''
    }
  }
}

/** 为缺少图片的商品尝试使用会话快照封面兜底。 */
async function fillMissingImagesFromConversation(list = []) {
  const coverCache = new Map()
  return Promise.all((list || []).map(async (item) => {
    if (!item) return item
    const images = resolveGoodsImages(item)
    if (images.length || !item._id) {
      return {
        ...item,
        images
      }
    }

    if (!coverCache.has(item._id)) {
      coverCache.set(item._id, getConversationCoverByGoodsId(item._id))
    }
    const cover = await coverCache.get(item._id)
    if (!cover) {
      return {
        ...item,
        images: []
      }
    }

    const finalImages = [cover]
    await syncGoodsLegacyFields(item._id, { images: finalImages })
    return {
      ...item,
      images: finalImages
    }
  }))
}

/** 清理字符串数组，去空、去重并限制数量和长度。 */
function sanitizeStringArray(list, maxCount, itemMaxLength) {
  if (!Array.isArray(list)) return []
  const dedup = []
  const seen = new Set()
  for (let i = 0; i < list.length; i += 1) {
    const text = toSafeText(list[i], itemMaxLength)
    if (!text || seen.has(text)) continue
    seen.add(text)
    dedup.push(text)
    if (dedup.length >= maxCount) break
  }
  return dedup
}

/** 校验并格式化价格，统一保留两位小数以内。 */
function normalizePrice(value) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    throw new Error('价格格式不正确')
  }
  const normalized = Math.round(parsed * 100) / 100
  if (normalized <= 0) {
    throw new Error('价格必须大于 0')
  }
  if (normalized > 99999) {
    throw new Error('价格不能超过 99999')
  }
  return normalized
}

/** 清理 AI 识别建议，防止异常字段直接入库。 */
function sanitizeAiSuggestion(aiSuggestion) {
  if (!aiSuggestion || typeof aiSuggestion !== 'object') return null
  return {
    title: toSafeText(aiSuggestion.title, MAX_TITLE_LENGTH),
    category: toSafeText(aiSuggestion.category, 20),
    tags: sanitizeStringArray(aiSuggestion.tags, 3, MAX_TAG_LENGTH),
    reason: toSafeText(aiSuggestion.reason, 120)
  }
}

/** 校验发布参数并整理成可写入数据库的结构。 */
function normalizeCreatePayload(payload = {}) {
  const title = toSafeText(payload.title, MAX_TITLE_LENGTH)
  const category = normalizeCategoryName(payload.category)
  const images = normalizeImageList(sanitizeStringArray(payload.images, MAX_IMAGE_COUNT, 500))
  if (!title) {
    throw new Error('商品名称不能为空')
  }
  if (!category) {
    throw new Error('商品分类不能为空')
  }
  if (!images.length) {
    throw new Error('请至少上传 1 张图片')
  }

  return {
    title,
    description: toSafeText(payload.description, MAX_DESCRIPTION_LENGTH),
    price: normalizePrice(payload.price),
    category,
    tags: sanitizeStringArray(payload.tags, MAX_TAG_COUNT, MAX_TAG_LENGTH),
    images,
    aiSuggestion: sanitizeAiSuggestion(payload.aiSuggestion)
  }
}

/**
 * 创建商品。
 * 原理：卖家昵称、头像、微信号在创建时直接冻结一份到 goods 集合，首页卡片展示会更快。
 */
async function createGoods(openid, payload = {}) {
  const user = (await getUser(openid)) || {}
  const normalized = normalizeCreatePayload(payload)
  const data = {
    title: normalized.title,
    description: normalized.description,
    price: normalized.price,
    category: normalized.category,
    tags: normalized.tags,
    images: normalized.images,
    ownerOpenid: openid,
    ownerNickName: user.nickName || '热心同学',
    ownerAvatarUrl: pickPublicAvatarRef(user.avatarUrl),
    ownerWechatNumber: user.wechatNumber || '',
    status: 'on',
    aiSuggestion: normalized.aiSuggestion,
    createdAt: new Date(),
    updatedAt: new Date()
  }
  return db.collection('goods').add({ data })
}

/** 用 users 集合里的最新资料刷新商品上的卖家信息。 */
async function hydrateOwnerProfile(list = []) {
  const ownerCache = new Map()
  return Promise.all((list || []).map(async (item) => {
    if (!item) return item
    const ownerOpenid = getOwnerOpenid(item)
    const normalizedItem = {
      ...item,
      ownerOpenid,
      category: normalizeCategoryName(item.category),
      status: normalizeGoodsStatus(item.status),
      images: resolveGoodsImages(item)
    }
    if (!ownerOpenid) {
      return {
        ...normalizedItem,
        ownerNickName: item.ownerNickName || '热心同学',
        ownerAvatarUrl: pickPublicAvatarRef(item.ownerAvatarUrl)
      }
    }
    if (!ownerCache.has(ownerOpenid)) {
      ownerCache.set(ownerOpenid, getUser(ownerOpenid))
    }
    const latestOwner = (await ownerCache.get(ownerOpenid)) || {}
    return {
      ...normalizedItem,
      ownerNickName: latestOwner.nickName || item.ownerNickName || '热心同学',
      ownerAvatarUrl: pickPublicAvatarRef(latestOwner.avatarUrl, item.ownerAvatarUrl)
    }
  }))
}

/** 批量获取云存储 fileID 的临时 HTTP 链接。 */
async function getTempUrlMap(fileIds = []) {
  const dedup = Array.from(
    new Set((fileIds || []).filter((id) => isCloudFileId(id)))
  )

  const map = new Map()
  if (!dedup.length) return map

  for (let i = 0; i < dedup.length; i += TEMP_URL_BATCH_SIZE) {
    const chunk = dedup.slice(i, i + TEMP_URL_BATCH_SIZE)

    try {
      const tempRes = await cloud.getTempFileURL({ fileList: chunk })

      ;(tempRes.fileList || []).forEach((entry) => {
        if (!entry || !entry.fileID) return

        if (entry.tempFileURL) {
          map.set(entry.fileID, entry.tempFileURL)
        } else {
          map.set(entry.fileID, '')
          console.warn('未获取到临时链接:', entry)
        }
      })
    } catch (error) {
      console.error('getTempFileURL 失败:', error)
      chunk.forEach((id) => map.set(id, ''))
    }
  }

  return map
}

/** 云文件转临时链接；原本就是 HTTP 的地址保持不变。 */
function resolveCloudOrKeepHttp(value = '', tempUrlMap = new Map()) {
  const text = String(value || '').trim()
  if (!text) return ''
  if (isCloudFileId(text)) {
    const tempUrl = tempUrlMap.get(text) || ''
    return isHttpUrl(tempUrl) ? tempUrl : ''
  }
  return text
}

/** 云文件头像转临时链接；本地临时头像直接丢弃。 */
function resolveAvatarOrEmpty(value = '', tempUrlMap = new Map()) {
  const text = String(value || '').trim()
  if (!text || isTempLocalFile(text)) return ''
  return resolveCloudOrKeepHttp(text, tempUrlMap)
}

/**
 * 把商品图和头像里的 cloud:// 转成临时 HTTP。
 * 修复点：之前只要同批数据里存在一个 cloud://，所有原本就是 HTTP 的图片都会被 map.get() 变成空字符串，
 * 这正是详情轮播“凭空多出空图”的主要原因之一。
 */
async function hydrateGoodsImagesWithTempUrl(list = []) {
  const fileIdSet = new Set()
  ;(list || []).forEach((item) => {
    resolveGoodsImages(item || {}).forEach((img) => {
      if (isCloudFileId(img)) fileIdSet.add(img)
    })
    if (item && item.ownerAvatarUrl && isCloudFileId(item.ownerAvatarUrl)) {
      fileIdSet.add(item.ownerAvatarUrl)
    }
  })

  const map = await getTempUrlMap(Array.from(fileIdSet))

  return (list || []).map((item) => ({
    ...item,
    images: resolveGoodsImages(item || {})
      .map((img) => resolveCloudOrKeepHttp(img, map))
      .filter(Boolean),
    ownerAvatarUrl: resolveAvatarOrEmpty(item && item.ownerAvatarUrl, map)
  }))
}

/** 组装列表接口返回值：补资料、补图片、转临时链接。 */
async function buildGoodsListResponse(rawList = []) {
  const profileHydrated = await hydrateOwnerProfile(rawList || [])
  const patchedImages = await fillMissingImagesFromConversation(profileHydrated)
  return hydrateGoodsImagesWithTempUrl(patchedImages)
}

/** 获取首页展示的商品。 */
async function listGoods() {
  const res = await db.collection('goods').orderBy('createdAt', 'desc').limit(MAX_GOODS_QUERY_LIMIT).get()
  const filtered = (res.data || [])
    .filter((item) => normalizeGoodsStatus(item && item.status) === 'on')
    .slice(0, 100)
  return buildGoodsListResponse(filtered)
}

/** 获取当前用户自己的商品。 */
async function listMine(openid) {
  const [primary, legacy] = await Promise.all([
    queryGoodsByField('ownerOpenid', openid, 100),
    queryGoodsByField('_openid', openid, 100)
  ])
  const merged = mergeGoodsList(primary.data || [], legacy.data || []).slice(0, 100)
  return buildGoodsListResponse(merged)
}

/** 获取某个卖家的公开商品。 */
async function listByOwner(ownerOpenid) {
  const normalizedOwnerOpenid = toSafeText(ownerOpenid, 80)
  if (!normalizedOwnerOpenid) return []
  const [primary, legacy] = await Promise.all([
    queryGoodsByField('ownerOpenid', normalizedOwnerOpenid, 100),
    queryGoodsByField('_openid', normalizedOwnerOpenid, 100)
  ])
  const merged = mergeGoodsList(primary.data || [], legacy.data || [])
    .filter((item) => normalizeGoodsStatus(item && item.status) === 'on')
    .slice(0, 100)
  return buildGoodsListResponse(merged)
}

/**
 * 更新商品状态。
 * 作用：允许发布者把商品标为已售或重新上架。
 */
async function updateStatus(openid, goodsId, status) {
  const detail = await getGoodsDoc(goodsId)
  if (getOwnerOpenid(detail) !== openid) {
    throw new Error('只能修改自己的商品状态')
  }
  if (!VALID_GOODS_STATUS.includes(status)) {
    throw new Error('商品状态不合法')
  }
  await db.collection('goods').doc(goodsId).update({
    data: {
      status,
      updatedAt: new Date()
    }
  })
  return true
}

/**
 * 删除商品。
 * 原理：除了删除 goods 本身，也把依附在这件商品上的会话与消息一并清掉，避免脏数据残留。
 */
async function deleteGoods(openid, goodsId) {
  const detail = await getGoodsDoc(goodsId)
  if (!detail || getOwnerOpenid(detail) !== openid) {
    throw new Error('只能删除自己发布的商品')
  }

  await removeConversationsByGoods(goodsId)

  await db.collection('goods').doc(goodsId).remove()
  return true
}

/** 删除某个会话下的所有消息。 */
async function removeMessagesByConversation(conversationId) {
  while (true) {
    const msgRes = await db.collection('messages').where({ conversationId }).limit(100).get()
    const messages = msgRes.data || []
    if (!messages.length) break
    await Promise.all(messages.map((item) => db.collection('messages').doc(item._id).remove()))
    if (messages.length < 100) break
  }
}

/** 删除某个商品关联的所有会话和消息。 */
async function removeConversationsByGoods(goodsId) {
  while (true) {
    const convRes = await db.collection('conversations').where({ goodsId }).limit(100).get()
    const conversations = convRes.data || []
    if (!conversations.length) break

    for (const conversation of conversations) {
      await removeMessagesByConversation(conversation._id)
    }
    await Promise.all(conversations.map((item) => db.collection('conversations').doc(item._id).remove()))
    if (conversations.length < 100) break
  }
}

/** 云函数主入口。 */
exports.main = async (event) => {
  const { OPENID } = getContext()
  const { action, payload, goodsId, status, ownerOpenid } = event

  switch (action) {
    case 'create': {
      const res = await createGoods(OPENID, payload)
      return { success: true, id: res._id }
    }
    case 'list': {
      const list = await listGoods()
      return { list }
    }
    case 'listByOwner': {
      const list = await listByOwner(ownerOpenid)
      return { list }
    }
    case 'detail': {
      const detail = await getGoodsDoc(goodsId)
      if (!detail) {
        throw new Error('商品不存在或已删除')
      }
      const ownerOpenidResolved = getOwnerOpenid(detail)
      const normalizedStatus = normalizeGoodsStatus(detail.status)
      const legacyPatch = {}
      if (!detail.ownerOpenid && ownerOpenidResolved) {
        legacyPatch.ownerOpenid = ownerOpenidResolved
      }
      if (normalizedStatus !== detail.status) {
        legacyPatch.status = normalizedStatus
      }
      if (Object.keys(legacyPatch).length) {
        await syncGoodsLegacyFields(goodsId, legacyPatch)
      }
      const latestOwner = (await getUser(ownerOpenidResolved)) || {}
      let imageList = resolveGoodsImages(detail)
      if (!imageList.length) {
        const convCover = await getConversationCoverByGoodsId(goodsId)
        if (convCover) {
          imageList = [convCover]
        }
      }
      const legacyPatchImages = {}
      if (!isSameStringArray(imageList, normalizeImageList(detail.images))) {
        if (imageList.length) {
          legacyPatchImages.images = imageList
        }
      }
      if (Object.keys(legacyPatchImages).length) {
        await syncGoodsLegacyFields(goodsId, legacyPatchImages)
      }
      const ownerAvatarUrl = pickPublicAvatarRef(latestOwner.avatarUrl, detail.ownerAvatarUrl)
      const hydratedDetail = (await hydrateGoodsImagesWithTempUrl([{
        images: imageList,
        ownerAvatarUrl
      }]))[0] || {}
      return {
        detail: {
          ...detail,
          ownerOpenid: ownerOpenidResolved,
          status: normalizedStatus,
          images: hydratedDetail.images || [],
          category: normalizeCategoryName(detail.category),
          ownerNickName: latestOwner.nickName || detail.ownerNickName || '热心同学',
          ownerAvatarUrl: hydratedDetail.ownerAvatarUrl || ownerAvatarUrl
        }
      }
    }
    case 'mine': {
      const list = await listMine(OPENID)
      return { list }
    }
    case 'updateStatus': {
      await updateStatus(OPENID, goodsId, status)
      return { success: true }
    }
    case 'delete': {
      await deleteGoods(OPENID, goodsId)
      return { success: true }
    }
    default:
      throw new Error(`未知 action: ${action}`)
  }
}
