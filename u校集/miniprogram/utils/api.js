/**
 * 云函数调用统一出口。
 * 作用：避免每个页面都手写 wx.cloud.callFunction，减少重复代码。
 * 原理：把云函数名字和参数统一封装，返回真正的 result 数据。
 */
function callCloud(name, data = {}) {
  return wx.cloud.callFunction({ name, data }).then((res) => res.result)
}

/** 登录并初始化用户档案。 */
function bootstrapUserProfile() {
  return callCloud('userManager', { action: 'bootstrap' })
}

/** 获取当前用户资料。 */
function getMyProfile() {
  return callCloud('userManager', { action: 'getMine' })
}

/** 获取某个用户的公开主页资料。 */
function getUserPublicProfile(openid) {
  return callCloud('userManager', { action: 'getPublicProfile', openid })
}

/** 保存当前用户资料。 */
function saveUserProfile(payload) {
  return callCloud('userManager', { action: 'saveProfile', payload })
}

/** 提交学校认证申请。 */
function submitSchoolAuth(payload) {
  return callCloud('userManager', { action: 'submitSchoolAuth', payload })
}

/** 获取认证申请列表（管理员）。 */
function listSchoolAuthRequests(status) {
  return callCloud('userManager', { action: 'listSchoolAuthRequests', status })
}

/** 审核认证申请（管理员）。 */
function reviewSchoolAuthRequest(requestId, status) {
  return callCloud('userManager', { action: 'reviewSchoolAuthRequest', requestId, status })
}

/** 获取首页商品列表。 */
function listGoods() {
  return callCloud('goodsManager', { action: 'list' })
}

/** 获取某个卖家的公开商品列表。 */
function listGoodsByOwner(ownerOpenid) {
  return callCloud('goodsManager', { action: 'listByOwner', ownerOpenid })
}

/** 获取商品详情。 */
function getGoodsDetail(goodsId) {
  return callCloud('goodsManager', { action: 'detail', goodsId })
}

/** 发布商品。 */
function createGoods(payload) {
  return callCloud('goodsManager', { action: 'create', payload })
}

/** 获取我的发布列表。 */
function listMyGoods() {
  return callCloud('goodsManager', { action: 'mine' })
}

/** 更新商品状态，例如在售 / 已售 / 下架。 */
function updateGoodsStatus(goodsId, status) {
  return callCloud('goodsManager', { action: 'updateStatus', goodsId, status })
}

/** 删除我发布的商品。 */
function deleteMyGoods(goodsId) {
  return callCloud('goodsManager', { action: 'delete', goodsId })
}

/** 确保当前用户与目标用户针对某件商品有一个会话。 */
function ensureConversation(goodsId, sellerOpenid = '') {
  return callCloud('messageManager', { action: 'ensureConversation', goodsId, sellerOpenid })
}

/** 获取会话列表。 */
function listConversations() {
  return callCloud('messageManager', { action: 'listConversations' })
}

/** 获取某个会话下的消息列表。 */
function listMessages(conversationId) {
  return callCloud('messageManager', { action: 'listMessages', conversationId })
}

/** 发送一条文字消息。 */
function sendMessage(conversationId, content) {
  return callCloud('messageManager', { action: 'sendMessage', conversationId, content })
}

module.exports = {
  callCloud,
  bootstrapUserProfile,
  getMyProfile,
  getUserPublicProfile,
  saveUserProfile,
  submitSchoolAuth,
  listSchoolAuthRequests,
  reviewSchoolAuthRequest,
  listGoods,
  listGoodsByOwner,
  getGoodsDetail,
  createGoods,
  listMyGoods,
  updateGoodsStatus,
  deleteMyGoods,
  ensureConversation,
  listConversations,
  listMessages,
  sendMessage
}
