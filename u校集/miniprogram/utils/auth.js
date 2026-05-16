const LOGIN_PAGE = '/pages/login/login'

function isLoggedInProfile(profile = {}) {
  return !!String(profile.nickName || '').trim()
}

function buildLoginUrl(from = '') {
  const scene = String(from || '').trim()
  return scene ? `${LOGIN_PAGE}?from=${encodeURIComponent(scene)}` : LOGIN_PAGE
}

async function ensureUserProfile() {
  const app = getApp()
  if (!app.globalData.loginReady) {
    await app.bootstrapUser()
  }
  return app.globalData.userProfile || {}
}

async function requireLogin(options = {}) {
  const profile = await ensureUserProfile()
  if (isLoggedInProfile(profile)) return true
  if (options.silent) return false

  wx.showModal({
    title: options.title || '请先登录',
    content: options.content || '完善昵称并保存后，就可以继续使用这个功能。',
    confirmText: '去登录',
    cancelText: '稍后',
    success: (res) => {
      if (!res.confirm) return
      wx.navigateTo({ url: buildLoginUrl(options.from || '') })
    }
  })
  return false
}

module.exports = {
  LOGIN_PAGE,
  isLoggedInProfile,
  buildLoginUrl,
  ensureUserProfile,
  requireLogin
}
