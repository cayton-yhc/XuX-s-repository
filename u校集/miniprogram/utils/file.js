/**
 * 文件与图片地址工具。
 * 作用：统一处理本地临时文件、云存储 fileID、HTTP 图片和项目内静态占位图。
 */
const TEMP_URL_BATCH_SIZE = 50

/** 获取文件扩展名，无法识别时默认按 jpg 上传。 */
function getFileExt(filePath = '') {
  const cleanPath = String(filePath || '').split('?')[0]
  const match = cleanPath.match(/\.([a-zA-Z0-9]+)$/)
  return match ? match[1] : 'jpg'
}

/** 判断是否为云存储 fileID。 */
function isCloudFileId(value = '') {
  return typeof value === 'string' && value.trim().startsWith('cloud://')
}

/** 判断是否为 HTTP/HTTPS 地址。 */
function isHttpUrl(value = '') {
  return /^https?:\/\//.test(String(value || '').trim())
}

/** 兼容旧版微信头像的 http 地址，避免线上 image 组件因非 HTTPS 加载失败。 */
function normalizeImageUrlForDisplay(value = '') {
  const text = String(value || '').trim()
  if (/^http:\/\/(thirdwx\.qlogo\.cn|wx\.qlogo\.cn|mmbiz\.qpic\.cn)\//.test(text)) {
    return text.replace(/^http:\/\//, 'https://')
  }
  return text
}

/** 判断是否为项目内静态资源，例如 /images/avatar-default.png。 */
function isLocalAssetPath(value = '') {
  const text = String(value || '').trim()
  return text.startsWith('/') && !text.startsWith('//')
}

/** 判断是否为小程序临时文件，保存资料或认证时需要先上传云存储。 */
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

function isDisplayableImage(value = '') {
  const text = String(value || '').trim()
  if (!text || isTempLocalFile(text)) return false
  // seller 页等公开场景，不允许临时文件直接展示
  return isHttpUrl(text) || isLocalAssetPath(text) || text.startsWith('data:image')
}

/** 从字符串或常见文件对象中抽取真正的图片地址。 */
function extractFileRef(source) {
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
    source.avatarUrl ||
    source.ownerAvatarUrl ||
    source.image ||
    source.imageUrl ||
    source.cover
  return String(candidate || '').trim()
}

/** 对字符串列表做去空、去重，避免轮播图出现空白项。 */
function uniqueStrings(list = []) {
  const seen = new Set()
  const result = []
  for (let i = 0; i < list.length; i += 1) {
    const text = String(list[i] || '').trim()
    if (!text || seen.has(text)) continue
    seen.add(text)
    result.push(text)
  }
  return result
}

/** 把单个值或数组统一整理成图片地址数组。 */
function normalizeFileRefs(input = [], maxCount = 50) {
  const source = Array.isArray(input) ? input : [input]
  const refs = []
  for (let i = 0; i < source.length; i += 1) {
    const item = source[i]
    if (Array.isArray(item)) {
      refs.push(...normalizeFileRefs(item, maxCount))
    } else {
      refs.push(extractFileRef(item))
    }
    if (refs.length >= maxCount) break
  }
  return uniqueStrings(refs).slice(0, maxCount)
}

/** 批量把 cloud:// fileID 转成临时 HTTP 链接。 */
async function getTempUrlMap(fileIds = []) {
  const ids = uniqueStrings(fileIds).filter(isCloudFileId)
  const map = new Map()
  if (!ids.length || !wx.cloud || !wx.cloud.getTempFileURL) return map

  for (let i = 0; i < ids.length; i += TEMP_URL_BATCH_SIZE) {
    const chunk = ids.slice(i, i + TEMP_URL_BATCH_SIZE)
    try {
      const res = await wx.cloud.getTempFileURL({ fileList: chunk })
      ;(res.fileList || []).forEach((item) => {
        if (item && item.fileID) {
          map.set(item.fileID, item.tempFileURL || '')
        }
      })
    } catch (error) {
      console.warn('获取云文件临时链接失败：', error)
      chunk.forEach((id) => map.set(id, ''))
    }
  }
  return map
}

/** 把单个 cloud:// fileID 替换成临时链接；普通 HTTP/本地静态图保持原样。 */
function replaceCloudFileId(value, tempUrlMap = new Map()) {
  const text = extractFileRef(value)
  if (!isCloudFileId(text)) return normalizeImageUrlForDisplay(text)
  const url = tempUrlMap.get(text) || ''
  return isHttpUrl(url) ? normalizeImageUrlForDisplay(url) : ''
}

/** 批量替换图片地址，并过滤掉无法展示的空值或失效值。 */
function replaceCloudFileIds(list = [], tempUrlMap = new Map()) {
  return uniqueStrings(
    normalizeFileRefs(list).map((value) => replaceCloudFileId(value, tempUrlMap))
  ).filter(isDisplayableImage)
}

/** 保持原数组长度地解析图片地址，适合列表页按下标回填封面和头像。 */
async function resolveDisplayUrlList(list = [], fallback = '') {
  const source = Array.isArray(list) ? list : [list]
  const refs = source.map((item) => extractFileRef(item))
  const tempUrlMap = await getTempUrlMap(refs)
  return refs.map((ref) => {
    const resolved = replaceCloudFileId(ref, tempUrlMap)
    return isDisplayableImage(resolved) ? resolved : fallback
  })
}

/** 解析单个图片地址，失败时返回传入的占位图。 */
async function resolveDisplayUrl(value = '', fallback = '') {
  const list = await resolveDisplayUrlList([value], fallback)
  return list[0] || fallback
}

/** 解析轮播图数组，去掉空图和重复图，最终至少保留占位图。 */
async function resolveDisplayImages(list = [], fallback = '') {
  const refs = normalizeFileRefs(list)
  const resolved = await resolveDisplayUrlList(refs, '')
  const images = uniqueStrings(resolved).filter(isDisplayableImage)
  return images.length ? images : (fallback ? [fallback] : [])
}

/** 上传单个本地文件到云存储，并返回 cloud:// fileID。 */
async function uploadFileToCloud(localPath, dir = 'uploads') {
  const ext = getFileExt(localPath)
  const cloudPath = `${dir}/${Date.now()}_${Math.random().toString(16).slice(2)}.${ext}`
  const res = await wx.cloud.uploadFile({
    cloudPath,
    filePath: localPath
  })
  return res.fileID
}

module.exports = {
  getFileExt,
  uploadFileToCloud,
  isCloudFileId,
  isHttpUrl,
  normalizeImageUrlForDisplay,
  isLocalAssetPath,
  isTempLocalFile,
  isDisplayableImage,
  extractFileRef,
  uniqueStrings,
  normalizeFileRefs,
  getTempUrlMap,
  replaceCloudFileId,
  replaceCloudFileIds,
  resolveDisplayUrl,
  resolveDisplayUrlList,
  resolveDisplayImages
}
