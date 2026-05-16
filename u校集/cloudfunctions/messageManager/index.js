/**
 * 私信管理云函数。
 * 作用：创建会话、发送消息、读取会话列表与聊天记录，并维护未读数。
 */
const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const MAX_MESSAGE_LENGTH = 200
const MESSAGE_PAGE_SIZE = 200
const READ_MARK_BATCH_SIZE = 100

/** 判断字符串是否为云存储 fileID。 */
function isCloudFileId(value = '') {
  return typeof value === 'string' && value.startsWith('cloud://')
}

/** 判断字符串是否为 HTTP/HTTPS 地址。 */
function isHttpUrl(value = '') {
  return /^https?:\/\//.test(String(value || '').trim())
}

/** 判断商品快照封面是否为合法图片引用。 */
function isValidImageRef(value = '') {
  return isCloudFileId(value) || isHttpUrl(value)
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

/** 清理商品图片数组，去空、去重并限制数量。 */
function normalizeImageList(images) {
  const list = Array.isArray(images) ? images : [images]
  const dedup = []
  const seen = new Set()
  for (let i = 0; i < list.length; i += 1) {
    const ref = extractImageRef(list[i])
    if (!isValidImageRef(ref) || seen.has(ref)) continue
    seen.add(ref)
    dedup.push(ref)
    if (dedup.length >= 3) break
  }
  return dedup
}

/** 从商品多个历史图片字段中选出会话快照封面。 */
function resolveGoodsCover(item = {}) {
  const images = normalizeImageList([
    ...(Array.isArray(item.images) ? item.images : [item.images]),
    ...(Array.isArray(item.imageList) ? item.imageList : [item.imageList]),
    ...(Array.isArray(item.imageUrls) ? item.imageUrls : [item.imageUrls]),
    item.image,
    item.imageUrl,
    item.cover,
    item.thumb
  ])
  return images[0] || ''
}

/** 统一商品状态，兼容历史中文状态。 */
function normalizeGoodsStatus(status) {
  const text = String(status || '').trim()
  if (!text) return 'on'
  if (['on', 'sold', 'off'].includes(text)) return text
  if (['已售', '售出'].includes(text)) return 'sold'
  if (['下架'].includes(text)) return 'off'
  return 'on'
}

/** 清理 openid 字符串。 */
function normalizeOpenid(value = '') {
  return String(value || '').trim()
}

/** 获取卖家 openid，兼容旧字段并支持前端兜底传入。 */
function pickOwnerOpenid(data = {}, fallbackSellerOpenid = '') {
  return normalizeOpenid(
    data.ownerOpenid ||
    data._openid ||
    data.sellerOpenid ||
    data.publisherOpenid ||
    fallbackSellerOpenid
  )
}

/** 根据当前用户判断会话中的对方 openid。 */
function pickOtherOpenid(conversation = {}, openid = '') {
  if (!conversation) return ''
  return conversation.sellerOpenid === openid ? conversation.buyerOpenid : conversation.sellerOpenid
}

/** 回填商品历史兼容字段，失败不影响私信流程。 */
async function syncLegacyGoodsFields(goodsId, updateData = {}) {
  const payload = { ...updateData }
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

/** 获取当前微信上下文。 */
function getContext() {
  return cloud.getWXContext()
}

/** 读取用户。 */
async function getUser(openid) {
  try {
    const res = await db.collection('users').doc(openid).get()
    return res.data
  } catch (error) {
    return null
  }
}

/** 读取商品。 */
async function getGoods(goodsId, fallbackSellerOpenid = '') {
  if (!goodsId) {
    throw new Error('商品不存在')
  }
  const res = await db.collection('goods').doc(goodsId).get()
  const data = res.data || {}
  const ownerOpenid = pickOwnerOpenid(data, fallbackSellerOpenid)
  const status = normalizeGoodsStatus(data.status)
  const patch = {}
  if (!data.ownerOpenid && ownerOpenid) patch.ownerOpenid = ownerOpenid
  if (status !== data.status) patch.status = status
  if (Object.keys(patch).length) {
    await syncLegacyGoodsFields(goodsId, patch)
  }
  const normalizedImages = normalizeImageList(data.images)
  const cover = resolveGoodsCover(data)
  return {
    ...data,
    ownerOpenid,
    status,
    images: normalizedImages.length ? normalizedImages : (cover ? [cover] : [])
  }
}

/** 读取会话。 */
async function getConversation(conversationId) {
  if (!conversationId) {
    throw new Error('会话不存在')
  }
  const res = await db.collection('conversations').doc(conversationId).get()
  return res.data
}

/** 清理消息内容并限制最大长度。 */
function trimMessage(content) {
  return String(content || '').trim().slice(0, MAX_MESSAGE_LENGTH)
}

/**
 * 校验当前用户是否属于该会话。
 * 原理：只有买家或卖家本人才能读写对应聊天记录。
 */
function assertConversationMember(conversation, openid) {
  if (!conversation || (conversation.sellerOpenid !== openid && conversation.buyerOpenid !== openid)) {
    throw new Error('无权访问该会话')
  }
}

/**
 * 确保会话存在。
 * 原理：同一件商品、同一买家与卖家之间只创建一个 conversation。
 */
async function ensureConversation(openid, goodsId, fallbackSellerOpenid = '') {
  const goods = await getGoods(goodsId, fallbackSellerOpenid)
  if (!goods) {
    throw new Error('商品不存在或已删除')
  }
  if (goods.status !== 'on') {
    throw new Error('该商品当前不可私信')
  }
  const sellerOpenid = normalizeOpenid(goods.ownerOpenid || fallbackSellerOpenid)
  if (!sellerOpenid) {
    throw new Error('商品缺少卖家信息，暂时无法私信')
  }
  if (openid === sellerOpenid) {
    throw new Error('不能给自己发私信')
  }
  const buyerOpenid = openid
  const existing = await db.collection('conversations')
    .where({ goodsId, sellerOpenid, buyerOpenid })
    .limit(1)
    .get()

  if (existing.data && existing.data.length) {
    const conversation = existing.data[0]
    if (!String(conversation.lastMessage || '').trim()) {
      await sendIntentMessage(
        openid,
        conversation._id,
        goodsId,
        { ...goods, ownerOpenid: sellerOpenid },
        conversation.unreadMap || {}
      )
      return {
        conversationId: conversation._id,
        created: true
      }
    }
    return {
      conversationId: conversation._id,
      created: false
    }
  }

  const data = {
    goodsId,
    sellerOpenid,
    buyerOpenid,
    participants: [sellerOpenid, buyerOpenid],
    goodsSnapshot: {
      title: goods.title,
      price: goods.price,
      category: goods.category,
      cover: resolveGoodsCover(goods)
    },
    lastMessage: '',
    lastMessageAt: new Date(),
    unreadMap: {
      [sellerOpenid]: 0,
      [buyerOpenid]: 0
    },
    createdAt: new Date(),
    updatedAt: new Date()
  }
  const res = await db.collection('conversations').add({ data })
  await sendIntentMessage(openid, res._id, goodsId, { ...goods, ownerOpenid: sellerOpenid }, data.unreadMap)
  return {
    conversationId: res._id,
    created: true
  }
}

/** 创建会话后自动发送购买意向消息。 */
async function sendIntentMessage(buyerOpenid, conversationId, goodsId, goods, unreadMap = {}) {
  const title = String(goods && goods.title ? goods.title : '该商品').slice(0, 30)
  const content = `你好，我对你发布的「${title}」感兴趣，方便聊聊吗？`
  await db.collection('messages').add({
    data: {
      conversationId,
      goodsId,
      fromOpenid: buyerOpenid,
      toOpenid: goods.ownerOpenid,
      content,
      type: 'text',
      read: false,
      createdAt: new Date()
    }
  })

  await db.collection('conversations').doc(conversationId).update({
    data: {
      lastMessage: content,
      lastMessageAt: new Date(),
      unreadMap: {
        ...unreadMap,
        [goods.ownerOpenid]: Number((unreadMap && unreadMap[goods.ownerOpenid]) || 0) + 1,
        [buyerOpenid]: 0
      },
      updatedAt: new Date()
    }
  })
}

/** 获取会话列表。 */
async function listConversations(openid) {
  const [sellerRes, buyerRes] = await Promise.all([
    db.collection('conversations').where({ sellerOpenid: openid }).limit(100).get(),
    db.collection('conversations').where({ buyerOpenid: openid }).limit(100).get()
  ])

  const dedupMap = new Map()
  const merged = [...(sellerRes.data || []), ...(buyerRes.data || [])]
  merged.forEach((item) => {
    if (item && item._id && !dedupMap.has(item._id)) {
      dedupMap.set(item._id, item)
    }
  })
  const deduped = Array.from(dedupMap.values())
  deduped.sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime())

  const list = await Promise.all(deduped.map(async (item) => {
    const otherOpenid = pickOtherOpenid(item, openid)
    const otherUser = (await getUser(otherOpenid)) || { nickName: '热心同学', avatarUrl: '', wechatNumber: '' }
    const [coverUrl, avatarUrl] = await Promise.all([
      toTempUrl(item.goodsSnapshot && item.goodsSnapshot.cover),
      toTempUrl(otherUser.avatarUrl)
    ])
    return {
      ...item,
      goodsSnapshot: {
        ...(item.goodsSnapshot || {}),
        cover: coverUrl
      },
      otherUser: {
        ...otherUser,
        avatarSourceUrl: otherUser.avatarUrl || '',
        avatarUrl: avatarUrl || keepAvatarWhenDisplayable(otherUser.avatarUrl)
      },
      unreadCount: item.unreadMap && item.unreadMap[openid] ? item.unreadMap[openid] : 0
    }
  }))
  return list
}

/**
 * 获取会话中的全部消息，并把当前用户未读数清零。
 */
async function listMessages(openid, conversationId) {
  const conversation = await getConversation(conversationId)
  assertConversationMember(conversation, openid)

  const res = await db.collection('messages')
    .where({ conversationId })
    .orderBy('createdAt', 'asc')
    .limit(MESSAGE_PAGE_SIZE)
    .get()

  await markConversationMessagesRead(conversationId, openid)

  const unreadMap = {
    ...(conversation.unreadMap || {}),
    [openid]: 0
  }
  await db.collection('conversations').doc(conversationId).update({
    data: {
      unreadMap,
      updatedAt: new Date()
    }
  })

  const otherOpenid = pickOtherOpenid(conversation, openid)
  const otherUser = (await getUser(otherOpenid)) || { nickName: '热心同学', avatarUrl: '', wechatNumber: '' }
  const [coverUrl, avatarUrl] = await Promise.all([
    toTempUrl(conversation.goodsSnapshot && conversation.goodsSnapshot.cover),
    toTempUrl(otherUser.avatarUrl)
  ])

  return {
    conversation: {
      ...conversation,
      goodsSnapshot: {
        ...(conversation.goodsSnapshot || {}),
        cover: coverUrl
      },
      unreadMap
    },
    messages: res.data || [],
    otherUser: {
      ...otherUser,
      avatarSourceUrl: otherUser.avatarUrl || '',
      avatarUrl: avatarUrl || keepAvatarWhenDisplayable(otherUser.avatarUrl)
    }
  }
}

/**
 * 把云存储 fileID 转成临时链接。
 * 修复点：转换失败返回空字符串而不是 cloud://，避免前端 image 组件直接渲染失效地址。
 */
async function toTempUrl(value) {
  if (!isCloudFileId(value)) return value || ''
  try {
    const res = await cloud.getTempFileURL({ fileList: [value] })
    const item = res.fileList && res.fileList[0]
    return (item && item.tempFileURL) || ''
  } catch (error) {
    return ''
  }
}


/** cloud:// 头像转换失败时不再回传原始 fileID，普通 HTTP 头像则保留。 */
function keepAvatarWhenDisplayable(value = '') {
  return isCloudFileId(value) ? '' : (value || '')
}

/** 把当前会话中发给自己的未读消息批量标记为已读。 */
async function markConversationMessagesRead(conversationId, openid) {
  while (true) {
    const unread = await db.collection('messages')
      .where({ conversationId, toOpenid: openid, read: false })
      .limit(READ_MARK_BATCH_SIZE)
      .get()

    const unreadMessages = unread.data || []
    if (!unreadMessages.length) break
    await Promise.all(
      unreadMessages.map((item) => db.collection('messages').doc(item._id).update({ data: { read: true } }))
    )
    if (unreadMessages.length < READ_MARK_BATCH_SIZE) break
  }
}

/**
 * 发送一条文字消息。
 * 原理：消息入库后同步刷新会话表里的 lastMessage / lastMessageAt / unreadMap。
 */
async function sendMessage(openid, conversationId, content) {
  const conversation = await getConversation(conversationId)
  assertConversationMember(conversation, openid)

  const text = trimMessage(content)
  if (!text) throw new Error('消息内容不能为空')

  const toOpenid = pickOtherOpenid(conversation, openid)
  await db.collection('messages').add({
    data: {
      conversationId,
      goodsId: conversation.goodsId,
      fromOpenid: openid,
      toOpenid,
      content: text,
      type: 'text',
      read: false,
      createdAt: new Date()
    }
  })

  const unreadMap = {
    ...(conversation.unreadMap || {}),
    [toOpenid]: Number((conversation.unreadMap && conversation.unreadMap[toOpenid]) || 0) + 1,
    [openid]: 0
  }

  await db.collection('conversations').doc(conversationId).update({
    data: {
      lastMessage: text,
      lastMessageAt: new Date(),
      unreadMap,
      updatedAt: new Date()
    }
  })

  return true
}

/** 云函数主入口。 */
exports.main = async (event) => {
  const { OPENID } = getContext()
  const { action, goodsId, conversationId, content, sellerOpenid } = event

  switch (action) {
    case 'ensureConversation': {
      return ensureConversation(OPENID, goodsId, sellerOpenid)
    }
    case 'listConversations': {
      const list = await listConversations(OPENID)
      return { list }
    }
    case 'listMessages': {
      return listMessages(OPENID, conversationId)
    }
    case 'sendMessage': {
      await sendMessage(OPENID, conversationId, content)
      return { success: true }
    }
    default:
      throw new Error(`未知 action: ${action}`)
  }
}
