const app = getApp()
const { saveUserProfile } = require('../../utils/api')
const { uploadFileToCloud, resolveDisplayUrl, isTempLocalFile, isCloudFileId, isHttpUrl } = require('../../utils/file')
const { defaultAvatar } = require('../../config/index')
const { goBackOrSwitchTab } = require('../../utils/helper')

/** 判断当前头像值是否需要先上传云存储再保存。 */
function shouldUploadAvatar(value = '') {
  const text = String(value || '').trim()
  if (!text || text === defaultAvatar || isCloudFileId(text)) return false
  if (isTempLocalFile(text)) return true
  if (isHttpUrl(text)) return false
  return !text.startsWith('/')
}

Page({
  data: {
    from: '',
    openid: '',
    profile: {
      nickName: '',
      avatarUrl: defaultAvatar,
      signature: '',
      wechatNumber: ''
    },
    avatarSourceUrl: '',
    avatarChanged: false,
    defaultAvatar,
    saving: false
  },

  onLoad(options = {}) {
    this.setData({ from: options.from || '' })
  },

  /** 页面显示时回填当前用户资料。 */
  onShow() {
    this.loadProfile()
  },

  /**
   * 读取当前用户资料并回填到表单。
   * 修复点：数据库里保存 cloud:// 头像时，表单展示用临时链接，保存时仍保留原始 fileID，避免把临时链接写回数据库。
   */
  async loadProfile() {
    try {
      if (!app.globalData.loginReady) {
        await app.bootstrapUser()
      }
      const profile = app.globalData.userProfile || {}
      const rawAvatar = profile.avatarUrl || ''
      const displayAvatar = await resolveDisplayUrl(rawAvatar, defaultAvatar)
      this.setData({
        openid: app.globalData.openid || '',
        avatarSourceUrl: rawAvatar,
        avatarChanged: false,
        profile: {
          nickName: profile.nickName || '',
          avatarUrl: displayAvatar || defaultAvatar,
          signature: profile.signature || '',
          wechatNumber: profile.wechatNumber || ''
        }
      })
    } catch (error) {
      console.error('资料页加载失败：', error)
      wx.showToast({ title: '加载失败', icon: 'none' })
    }
  },

  /** 手动刷新微信账号，确保 users 集合中存在当前用户文档。 */
  async handleLogin() {
    try {
      wx.showLoading({ title: '初始化中', mask: true })
      await app.bootstrapUser()
      await this.loadProfile()
      wx.hideLoading()
      wx.showToast({ title: '初始化成功', icon: 'success' })
    } catch (error) {
      wx.hideLoading()
      console.error('初始化账号失败：', error)
      wx.showToast({ title: '初始化失败', icon: 'none' })
    }
  },

  /** 选择头像：这里只记录本地临时路径，真正上传发生在保存时。 */
  onChooseAvatar(e) {
    const avatarUrl = e.detail.avatarUrl
    this.setData({
      'profile.avatarUrl': avatarUrl,
      avatarChanged: true
    })
  },

  /** 昵称输入。 */
  onNickNameInput(e) {
    this.setData({ 'profile.nickName': e.detail.value })
  },

  /** 昵称失焦兜底同步。 */
  onNickNameBlur(e) {
    this.setData({ 'profile.nickName': e.detail.value })
  },

  /** 个性签名输入。 */
  onSignatureInput(e) {
    this.setData({ 'profile.signature': e.detail.value })
  },

  /** 微信号输入。 */
  onWechatInput(e) {
    this.setData({ 'profile.wechatNumber': e.detail.value })
  },

  /**
   * 保存个人资料。
   * 修复点：未更换头像时保存原始 cloud://，更换头像时先上传，避免详情页拿到过期临时头像。
   */
  async saveProfile() {
    const { profile, saving, avatarChanged, avatarSourceUrl } = this.data
    if (saving) return
    const nickName = String(profile.nickName || '').trim()
    if (!nickName) {
      wx.showToast({ title: '请先填写昵称', icon: 'none' })
      return
    }
    this.setData({ saving: true })
    wx.showLoading({ title: '保存中', mask: true })
    try {
      let avatarUrl = avatarChanged ? (profile.avatarUrl || '') : (avatarSourceUrl || '')
      if (shouldUploadAvatar(avatarUrl)) {
        avatarUrl = await uploadFileToCloud(avatarUrl, 'avatars')
      }

      await saveUserProfile({
        nickName,
        avatarUrl,
        signature: String(profile.signature || '').trim(),
        wechatNumber: String(profile.wechatNumber || '').trim()
      })
      await app.refreshUserProfile()
      wx.hideLoading()
      wx.showToast({ title: '已登录', icon: 'success' })
      await this.loadProfile()
      this.finishAfterLogin()
    } catch (error) {
      wx.hideLoading()
      console.error('保存资料失败：', error)
      wx.showToast({ title: '保存失败', icon: 'none' })
    } finally {
      this.setData({ saving: false })
    }
  },

  /** 复制 openid，方便配置管理员或排查问题。 */
  copyOpenid() {
    if (!this.data.openid) return
    wx.setClipboardData({ data: this.data.openid })
  },

  finishAfterLogin() {
    const redirectMap = {
      publish: '/pages/publish/publish',
      message: '/pages/message/message'
    }
    const target = redirectMap[this.data.from]
    setTimeout(() => {
      if (target) {
        wx.switchTab({ url: target })
        return
      }
      if (this.data.from && getCurrentPages().length > 1) {
        wx.navigateBack({ delta: 1 })
      }
    }, 650)
  },

  /** 返回上一页，没有上一页时退回“我的”页。 */
  goBack() {
    goBackOrSwitchTab('/pages/profile/profile')
  }
})
