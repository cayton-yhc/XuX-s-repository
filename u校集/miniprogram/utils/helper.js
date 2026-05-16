/**
 * 版本比较函数。
 * 作用：判断当前基础库是否满足 AI 能力、头像昵称能力等要求。
 */
function compareVersion(v1, v2) {
  const s1 = String(v1).split('.')
  const s2 = String(v2).split('.')
  const len = Math.max(s1.length, s2.length)
  while (s1.length < len) s1.push('0')
  while (s2.length < len) s2.push('0')
  for (let i = 0; i < len; i += 1) {
    const n1 = parseInt(s1[i], 10)
    const n2 = parseInt(s2[i], 10)
    if (n1 > n2) return 1
    if (n1 < n2) return -1
  }
  return 0
}

/**
 * 尝试从大模型输出中提取 JSON。
 * 作用：AI 常常会返回带说明文字的结果，这个函数会把 JSON 片段切出来并转对象。
 */
function extractJsonFromText(text = '') {
  try {
    return JSON.parse(text)
  } catch (error) {
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start !== -1 && end !== -1 && end > start) {
      return JSON.parse(text.slice(start, end + 1))
    }
    throw error
  }
}

/**
 * 安全地读取大模型返回文本。
 * 作用：兼容不同 SDK 返回结构，尽量拿到真正的文本内容。
 */
function getModelText(res = {}) {
  return res.text || (res.choices && res.choices[0] && res.choices[0].message && res.choices[0].message.content) || ''
}

/**
 * 统一的返回方法。
 * 原理：有上一页就 navigateBack；如果当前页面是直接打开的，则降级切回指定 tab 页面。
 */
function goBackOrSwitchTab(fallback = '/pages/home/home') {
  const pages = getCurrentPages()
  if (pages.length > 1) {
    wx.navigateBack({ delta: 1 })
    return
  }
  wx.switchTab({ url: fallback })
}

module.exports = {
  compareVersion,
  extractJsonFromText,
  getModelText,
  goBackOrSwitchTab
}
