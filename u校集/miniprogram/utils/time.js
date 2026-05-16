/**
 * 补零函数。
 * 作用：格式化时间时让月份、日期、小时等保持两位数显示。
 */
function pad(n) {
  return n < 10 ? `0${n}` : `${n}`
}

/**
 * 格式化为完整时间。
 * 作用：商品详情、认证提交时间等需要展示完整时间时复用。
 */
function formatFullTime(input) {
  const date = normalizeDate(input)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/**
 * 格式化为相对时间。
 * 作用：消息列表、商品发布时间等场景更适合展示“刚刚 / 3小时前”。
 */
function formatRelativeTime(input) {
  const date = normalizeDate(input)
  const diff = Date.now() - date.getTime()
  const minute = 60 * 1000
  const hour = 60 * minute
  const day = 24 * hour
  if (diff < minute) return '刚刚'
  if (diff < hour) return `${Math.floor(diff / minute)}分钟前`
  if (diff < day) return `${Math.floor(diff / hour)}小时前`
  if (diff < 7 * day) return `${Math.floor(diff / day)}天前`
  return formatFullTime(date)
}

/**
 * 统一把数据库 serverDate / ISO 字符串 / 时间戳转成 Date。
 */
function normalizeDate(input) {
  let date
  if (!input) date = new Date()
  else if (input instanceof Date) date = input
  else if (typeof input === 'number') date = new Date(input)
  else if (typeof input === 'string') date = new Date(input)
  else if (input && input.$date) date = new Date(input.$date)
  else if (input && input.toDate) date = input.toDate()
  else date = new Date(input)
  return Number.isNaN(date.getTime()) ? new Date() : date
}

module.exports = {
  formatFullTime,
  formatRelativeTime,
  normalizeDate
}
