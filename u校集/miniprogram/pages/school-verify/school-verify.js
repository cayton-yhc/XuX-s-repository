const app = getApp()
const { submitSchoolAuth } = require('../../utils/api')
const { uploadFileToCloud, isTempLocalFile } = require('../../utils/file')
const { goBackOrSwitchTab } = require('../../utils/helper')

Page({
  data: {
    form: {
      realName: '',
      studentNo: '',
      college: '',
      major: '',
      remark: '',
      cardImage: ''
    },
    currentStatus: 'unsubmitted',
    submitting: false
  },

  /** 用当前用户资料中的认证状态做页面回显。 */
  onShow() {
    const profile = app.globalData.userProfile || {}
    this.setData({ currentStatus: profile.schoolVerifyStatus || 'unsubmitted' })
  },

  /** 通用表单输入处理。 */
  onInput(e) {
    const field = e.currentTarget.dataset.field
    if (!field) return
    this.setData({ [`form.${field}`]: e.detail.value })
  },

  /** 选择学生证/校园卡图片。 */
  async chooseCardImage() {
    try {
      const res = await wx.chooseMedia({ count: 1, mediaType: ['image'], sourceType: ['album', 'camera'] })
      const file = res.tempFiles && res.tempFiles[0]
      if (!file) return
      this.setData({ 'form.cardImage': file.tempFilePath })
    } catch (error) {
      if (error && String(error.errMsg || '').includes('cancel')) return
      wx.showToast({ title: '选择图片失败', icon: 'none' })
    }
  },

  /**
   * 提交学校认证。
   * 修复点：兼容 wxfile://、http://tmp、http://usr 等临时路径，提交前统一上传云存储。
   */
  async submitVerify() {
    const { form, submitting } = this.data
    if (submitting) return
    if (!form.realName || !form.studentNo || !form.college) {
      wx.showToast({ title: '请完善姓名 / 学号 / 学院', icon: 'none' })
      return
    }

    this.setData({ submitting: true })
    wx.showLoading({ title: '提交中', mask: true })
    try {
      let cardImage = form.cardImage || ''
      if (cardImage && isTempLocalFile(cardImage)) {
        cardImage = await uploadFileToCloud(cardImage, 'school-auth')
      }

      await submitSchoolAuth({
        realName: String(form.realName || '').trim(),
        studentNo: String(form.studentNo || '').trim(),
        college: String(form.college || '').trim(),
        major: String(form.major || '').trim(),
        remark: String(form.remark || '').trim(),
        cardImage
      })

      await app.refreshUserProfile()
      wx.hideLoading()
      wx.showToast({ title: '已提交，等待审核', icon: 'success' })
      this.setData({ currentStatus: 'pending' })
    } catch (error) {
      wx.hideLoading()
      console.error('提交认证失败：', error)
      wx.showToast({ title: '提交失败', icon: 'none' })
    } finally {
      this.setData({ submitting: false })
    }
  },

  /** 返回上一页，没有上一页时回到“我的”页。 */
  goBack() {
    goBackOrSwitchTab('/pages/profile/profile')
  }
})
