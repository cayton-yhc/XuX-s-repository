const { toolboxCards } = require('../../config/index')
const { goBackOrSwitchTab } = require('../../utils/helper')

Page({
  data: {
    toolboxCards
  },

  /**
   * 打开某个工具箱卡片。
   * 原理：当前先用弹窗展示静态说明，后续你可以把它改成跳转学校页面、web-view、云数据库公告列表等。
   */
  openTool(e) {
    const index = Number(e.currentTarget.dataset.index)
    const item = this.data.toolboxCards[index]
    if (!item) return
    wx.showModal({
      title: item.title,
      content: item.detail,
      showCancel: false,
      confirmText: '知道了'
    })
  },

  /** 返回上一页，没有上一页时回到“我的”页。 */
  goBack() {
    goBackOrSwitchTab('/pages/profile/profile')
  }
})
