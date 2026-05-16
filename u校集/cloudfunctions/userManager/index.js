const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

/**
 * 管理员 openid 白名单。
 * 使用方法：先在“登录与资料”页复制自己的 openid，再填到这里重新部署 userManager 云函数。
 */
const adminOpenids = ["oIuZS3XJMhRm9EnlajlORgxh6x3E"]

/** 获取当前微信上下文。 */
function getContext() {
  return cloud.getWXContext()
}

/**
 * 清理数据库系统保留字段。
 * 原理：users 集合用 doc(openid) 作为主键时，_id 已经由文档路径决定，
 * 再把 get() 回来的 _id / _openid 原样写回 set 或 update 会触发报错。
 */
function stripReadonlyFields(doc = {}) {
  const cloned = { ...doc }
  delete cloned._id
  delete cloned._openid
  return cloned
}

/** 判断当前 openid 是否在管理员白名单中。 */
function isAdmin(openid) {
  return Array.isArray(adminOpenids) && adminOpenids.includes(openid)
}

/** 判断字符串是否为云存储 fileID。 */
function isCloudFileId(value = '') {
  return typeof value === 'string' && value.trim().startsWith('cloud://')
}

/** 判断字符串是否为 HTTP/HTTPS 地址。 */
function isHttpUrl(value = '') {
  return /^https?:\/\//.test(String(value || '').trim())
}

/** 判断字符串是否为小程序本地临时文件，这类地址不能作为公开头像保存或展示。 */
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

/** 公开资料头像在云函数侧转成临时链接，避免前端拿到 cloud:// 后无法展示。 */
async function resolvePublicAvatarUrl(value = '') {
  const avatarUrl = String(value || '').trim()
  if (isTempLocalFile(avatarUrl)) return ''
  if (!avatarUrl || !isCloudFileId(avatarUrl)) return avatarUrl

  try {
    const res = await cloud.getTempFileURL({ fileList: [avatarUrl] })
    const item = (res.fileList || [])[0] || {}
    return isHttpUrl(item.tempFileURL) ? item.tempFileURL : avatarUrl
  } catch (error) {
    console.warn('公开头像临时链接转换失败：', error)
    return avatarUrl
  }
}

/** 保存资料时拦截本地临时头像，避免覆盖已有的可公开展示头像。 */
function normalizeAvatarForSave(nextAvatar = '', previousAvatar = '') {
  const next = String(nextAvatar || '').trim()
  const previous = String(previousAvatar || '').trim()
  if (!next) return ''
  if (isTempLocalFile(next)) return isTempLocalFile(previous) ? '' : previous
  return next
}

/** 读取指定用户资料，读取不到时返回 null。 */
async function getUser(openid) {
  try {
    const res = await db.collection('users').doc(openid).get()
    return res.data
  } catch (error) {
    return null
  }
}

/** 写入用户文档，统一剔除只读字段。 */
async function writeUserDoc(openid, data = {}) {
  await db.collection('users').doc(openid).set({
    data: stripReadonlyFields(data)
  })
}

/** 确保当前用户存在；不存在则创建默认资料。 */
async function ensureUser(openid) {
  const existing = await getUser(openid)
  if (existing) return existing

  const user = {
    nickName: '',
    avatarUrl: '',
    signature: '',
    wechatNumber: '',
    schoolVerified: false,
    schoolVerifyStatus: 'unsubmitted',
    createdAt: new Date(),
    updatedAt: new Date()
  }
  await writeUserDoc(openid, user)
  return user
}

/** 保存用户资料，只更新前端传入的字段。 */
async function saveProfile(openid, payload = {}) {
  const user = stripReadonlyFields(await ensureUser(openid))
  const has = (key) => Object.prototype.hasOwnProperty.call(payload, key)
  const merged = {
    ...user,
    nickName: has('nickName') ? String(payload.nickName || '').trim() : String(user.nickName || '').trim(),
    avatarUrl: has('avatarUrl') ? normalizeAvatarForSave(payload.avatarUrl, user.avatarUrl) : (user.avatarUrl || ''),
    signature: has('signature') ? String(payload.signature || '').trim() : String(user.signature || '').trim(),
    wechatNumber: has('wechatNumber') ? String(payload.wechatNumber || '').trim() : String(user.wechatNumber || '').trim(),
    updatedAt: new Date()
  }
  await writeUserDoc(openid, merged)
  return merged
}

/** 提交学校认证申请，并同步用户认证状态为待审核。 */
async function submitSchoolAuth(openid, payload = {}) {
  await ensureUser(openid)
  const requestData = {
    submitOpenid: openid,
    realName: String(payload.realName || '').trim(),
    studentNo: String(payload.studentNo || '').trim(),
    college: String(payload.college || '').trim(),
    major: String(payload.major || '').trim(),
    remark: String(payload.remark || '').trim(),
    cardImage: payload.cardImage || '',
    status: 'pending',
    createdAt: new Date(),
    updatedAt: new Date()
  }
  const addRes = await db.collection('school_auth_requests').add({ data: requestData })

  const user = stripReadonlyFields(await ensureUser(openid))
  await writeUserDoc(openid, {
    ...user,
    schoolVerifyStatus: 'pending',
    schoolVerified: false,
    updatedAt: new Date()
  })

  return { requestId: addRes._id }
}

/** 读取用户公开主页资料。 */
async function getPublicProfile(openid) {
  const user = stripReadonlyFields(await ensureUser(openid))
  const avatarUrl = await resolvePublicAvatarUrl(user.avatarUrl)
  return {
    nickName: user.nickName || '热心同学',
    avatarUrl: avatarUrl || '',
    signature: user.signature || '这个同学还没有留下个性签名。',
    schoolVerified: !!user.schoolVerified,
    schoolVerifyStatus: user.schoolVerifyStatus || 'unsubmitted'
  }
}

/** 管理员读取认证申请。 */
async function listSchoolAuthRequests(openid, status = 'pending') {
  if (!isAdmin(openid)) {
    throw new Error('当前账号不是管理员，请先在 cloudfunctions/userManager/index.js 中配置 adminOpenids 并重新部署云函数')
  }
  const where = status ? { status } : {}
  const res = await db.collection('school_auth_requests')
    .where(where)
    .orderBy('createdAt', 'desc')
    .limit(100)
    .get()
  return res.data || []
}

/** 管理员审核认证申请。 */
async function reviewSchoolAuthRequest(openid, requestId, status) {
  if (!isAdmin(openid)) {
    throw new Error('当前账号不是管理员，请先在 cloudfunctions/userManager/index.js 中配置 adminOpenids 并重新部署云函数')
  }
  if (!['approved', 'rejected'].includes(status)) {
    throw new Error('审核状态不合法')
  }

  const res = await db.collection('school_auth_requests').doc(requestId).get()
  const request = res.data
  if (!request) throw new Error('未找到认证申请')

  await db.collection('school_auth_requests').doc(requestId).update({
    data: {
      status,
      updatedAt: new Date(),
      reviewedAt: new Date(),
      reviewedBy: openid
    }
  })

  const user = stripReadonlyFields(await ensureUser(request.submitOpenid))
  await writeUserDoc(request.submitOpenid, {
    ...user,
    schoolVerifyStatus: status,
    schoolVerified: status === 'approved',
    updatedAt: new Date()
  })

  return true
}

/** 云函数主入口：按 action 分发用户相关操作。 */
exports.main = async (event) => {
  const { OPENID } = getContext()
  const { action, payload, openid, status, requestId } = event

  switch (action) {
    case 'bootstrap': {
      const user = await ensureUser(OPENID)
      return { user, isAdmin: isAdmin(OPENID) }
    }
    case 'getMine': {
      const user = await ensureUser(OPENID)
      return { user, isAdmin: isAdmin(OPENID) }
    }
    case 'getPublicProfile': {
      const user = await getPublicProfile(openid)
      return { user }
    }
    case 'saveProfile': {
      const user = await saveProfile(OPENID, payload)
      return { user }
    }
    case 'submitSchoolAuth': {
      const result = await submitSchoolAuth(OPENID, payload)
      return { success: true, ...result }
    }
    case 'listSchoolAuthRequests': {
      const list = await listSchoolAuthRequests(OPENID, status)
      return { list }
    }
    case 'reviewSchoolAuthRequest': {
      await reviewSchoolAuthRequest(OPENID, requestId, status)
      return { success: true }
    }
    default:
      throw new Error(`未知 action: ${action}`)
  }
}
