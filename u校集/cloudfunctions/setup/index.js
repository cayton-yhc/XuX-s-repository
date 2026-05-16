const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

/**
 * 一次性创建项目所需集合。
 * 作用：让你第一次导入工程时更省事，不需要手动逐个创建集合。
 */
exports.main = async () => {
  const collections = ['users', 'goods', 'conversations', 'messages', 'school_auth_requests']
  const results = []

  for (const name of collections) {
    try {
      await db.createCollection(name)
      results.push({ collection: name, status: 'created' })
    } catch (error) {
      results.push({ collection: name, status: 'exists-or-failed', message: error.message })
    }
  }

  return {
    success: true,
    results
  }
}
