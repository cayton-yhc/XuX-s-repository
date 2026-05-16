/**
 * 发布页逻辑。
 * 作用：上传商品图片、AI 辅助识别、填写商品信息并调用云函数发布。
 */
const { publishCategories, categoryTagMap, defaultTagOptions } = require('../../config/index')
const { createGoods } = require('../../utils/api')
const { uploadFileToCloud } = require('../../utils/file')
const { compareVersion, extractJsonFromText, getModelText } = require('../../utils/helper')
const { requireLogin, buildLoginUrl } = require('../../utils/auth')

const MAX_PRICE = 99999
const MAX_TITLE_LENGTH = 40
const MAX_DESCRIPTION_LENGTH = 300
const MAX_AI_TAG_COUNT = 3
const DEFAULT_TAG_TITLE = '4. 补充标签（选填）'
const BOOK_TAG_TITLE = '4. 书籍标签（选填）'
const DEFAULT_TAG_HINT = '标签可不选，发布后买家依旧可以通过分类和标题找到商品。'
const BOOK_TAG_HINT = '教材资料建议补充标签，买家会更快找到你。'

const CATEGORY_KEYWORDS = {
  教材资料: ['教材', '考研', '笔记', '课本', '书', '练习册', '真题', '资料', '实验报告'],
  数码电子: ['手机', '平板', '电脑', '耳机', '充电器', '鼠标', '键盘', '显示器', 'ipad'],
  生活日用: ['台灯', '收纳', '床帘', '风扇', '水壶', '置物架', '小家电', '日用'],
  服饰鞋包: ['衣服', '外套', '裤子', '鞋', '包', '帽子'],
  文体乐器: ['球拍', '篮球', '足球', '自行车', '哑铃', '瑜伽垫', '吉他', '乐器', '桌游'],
  票券服务: ['卡券', '电影票', '门票', '优惠券', '礼品卡', '演出'],
  其他: []
}

const TAG_KEYWORDS = {
  教材: ['教材', '课本', '讲义'],
  实验报告: ['实验报告', '实验', '实验手册'],
  考研资料: ['考研', '考研资料'],
  期末真题: ['期末', '真题'],
  课堂笔记: ['笔记', '课堂笔记'],
  习题答案: ['习题答案', '习题', '题解'],
  竞赛资料: ['竞赛', '比赛资料'],
  四六级: ['四级', '六级', 'cet'],
  雅思托福: ['雅思', '托福'],
  编程资料: ['编程', '算法', '代码'],
  专业课资料: ['专业课', '专课资料'],
  平板: ['平板', 'ipad'],
  手机: ['手机', 'iphone', '安卓'],
  电脑: ['电脑', '笔记本', 'macbook'],
  耳机: ['耳机', 'airpods'],
  键鼠: ['鼠标', '键盘', '键鼠'],
  配件: ['配件', '适配器', '数据线'],
  台灯: ['台灯'],
  收纳: ['收纳', '置物'],
  小家电: ['小家电', '电器'],
  宿舍用品: ['宿舍', '日用'],
  几乎全新: ['几乎全新', '全新'],
  衣物: ['衣服', '外套', '衬衫', '裙'],
  鞋子: ['鞋', '球鞋', '跑鞋'],
  包包: ['包', '背包'],
  配饰: ['配饰', '项链', '手链', '帽子'],
  九成新: ['九成新', '成色好'],
  球拍: ['球拍', '羽毛球拍', '网球拍'],
  球类: ['篮球', '足球', '排球'],
  健身: ['哑铃', '健身', '瑜伽'],
  吉他: ['吉他'],
  键盘: ['键盘'],
  桌游: ['桌游', '剧本杀'],
  电影票: ['电影票', '电影'],
  演出票: ['演出', '门票'],
  校园卡券: ['卡券', '优惠券', '礼品卡'],
  课程转让: ['课程', '转让'],
  可议价: ['可议价', '小刀'],
  校内自提: ['自提', '校内'],
  当面验货: ['面交', '验货']
}

const allTagOptions = uniqueList(
  [...defaultTagOptions, ...Object.values(categoryTagMap || {}).flat()],
  200,
  20
)

/** 把已选标签数组转成映射表，方便 WXML 判断 active 状态。 */
function buildTagMap(tags = []) {
  return tags.reduce((acc, item) => {
    acc[item] = true
    return acc
  }, {})
}

/** 格式化价格输入，只保留数字和最多两位小数。 */
function normalizePriceInput(rawValue = '') {
  const text = String(rawValue || '').replace(/[^\d.]/g, '')
  const parts = text.split('.')
  const integerPart = (parts[0] || '').replace(/^0+(?=\d)/, '')
  if (parts.length <= 1) return integerPart
  const decimalPart = parts.slice(1).join('').slice(0, 2)
  return decimalPart ? `${integerPart || '0'}.${decimalPart}` : `${integerPart || '0'}.`
}

/** 校验最终提交价格。 */
function parsePrice(rawValue) {
  const value = String(rawValue || '').trim()
  if (!value) {
    throw new Error('请填写期望价格')
  }
  const price = Number(value)
  if (!Number.isFinite(price)) {
    throw new Error('价格格式不正确')
  }
  const normalized = Math.round(price * 100) / 100
  if (normalized <= 0) {
    throw new Error('价格必须大于 0')
  }
  if (normalized > MAX_PRICE) {
    throw new Error(`价格不能超过 ${MAX_PRICE}`)
  }
  return normalized
}

/** 归一化文本，便于关键词匹配。 */
function normalizeText(value = '') {
  return String(value || '').toLowerCase().replace(/\s+/g, '')
}

/** 字符串数组去空、去重并限制数量和长度。 */
function uniqueList(list = [], maxCount = 5, maxTextLength = 20) {
  const result = []
  const seen = new Set()
  for (let i = 0; i < list.length; i += 1) {
    const text = String(list[i] || '').trim().slice(0, maxTextLength)
    if (!text || seen.has(text)) continue
    seen.add(text)
    result.push(text)
    if (result.length >= maxCount) break
  }
  return result
}

/** 在候选项中匹配 AI 返回的分类或标签。 */
function matchOption(input, options = []) {
  const raw = String(input || '').trim()
  if (!raw) return ''
  if (options.includes(raw)) return raw

  const normalizedRaw = normalizeText(raw)
  for (let i = 0; i < options.length; i += 1) {
    const option = options[i]
    const normalizedOption = normalizeText(option)
    if (normalizedRaw === normalizedOption || normalizedRaw.includes(normalizedOption) || normalizedOption.includes(normalizedRaw)) {
      return option
    }
  }
  return ''
}

/** 根据 AI 结果和关键词推断商品分类。 */
function inferCategory(inputCategory, fallbackText = '') {
  const direct = matchOption(inputCategory, publishCategories)
  if (direct) return direct

  const text = normalizeText(`${inputCategory || ''} ${fallbackText || ''}`)
  for (let i = 0; i < publishCategories.length; i += 1) {
    const option = publishCategories[i]
    if (text.includes(normalizeText(option))) return option
  }

  for (let i = 0; i < publishCategories.length; i += 1) {
    const option = publishCategories[i]
    const keywords = CATEGORY_KEYWORDS[option] || []
    if (keywords.some((word) => text.includes(normalizeText(word)))) {
      return option
    }
  }
  return ''
}

/** 根据 AI 结果和关键词推断商品标签。 */
function inferTags(rawTags = [], fallbackText = '') {
  const result = []
  const addTag = (tag) => {
    if (!tag || result.includes(tag) || result.length >= MAX_AI_TAG_COUNT) return
    result.push(tag)
  }

  uniqueList(rawTags, MAX_AI_TAG_COUNT, 20).forEach((tag) => {
    const matched = matchOption(tag, allTagOptions)
    if (matched) addTag(matched)
  })

  const text = normalizeText(fallbackText)
  for (let i = 0; i < allTagOptions.length && result.length < MAX_AI_TAG_COUNT; i += 1) {
    const option = allTagOptions[i]
    if (text.includes(normalizeText(option))) {
      addTag(option)
      continue
    }
    const keywords = TAG_KEYWORDS[option] || []
    if (keywords.some((word) => text.includes(normalizeText(word)))) {
      addTag(option)
    }
  }

  return result.slice(0, MAX_AI_TAG_COUNT)
}

/** 清理 AI 建议，保证只回填当前配置允许的分类和标签。 */
function normalizeAiSuggestion(aiSuggestion = {}, rawText = '') {
  const safeSuggestion = aiSuggestion && typeof aiSuggestion === 'object' ? aiSuggestion : {}
  const fallbackText = [
    safeSuggestion.title,
    safeSuggestion.category,
    Array.isArray(safeSuggestion.tags) ? safeSuggestion.tags.join(' ') : '',
    safeSuggestion.reason,
    rawText
  ].join(' ')

  return {
    title: String(safeSuggestion.title || '').trim().slice(0, MAX_TITLE_LENGTH),
    category: inferCategory(safeSuggestion.category, fallbackText),
    tags: inferTags(safeSuggestion.tags, fallbackText),
    reason: String(safeSuggestion.reason || '').trim().slice(0, 80)
  }
}

/** 构造视觉模型提示词，重试时收紧输出格式。 */
function buildPrompt(isRetry = false) {
  if (isRetry) {
    return `请严格输出 JSON，不要输出任何解释。JSON 结构固定为：{"title":"商品名称","category":"分类","tags":["标签1","标签2"],"reason":"一句话识别依据"}。category 只能从 [${publishCategories.join('、')}] 中选择，tags 只能从 [${allTagOptions.join('、')}] 中选择且最多 3 个。`
  }
  return `你是校园二手商品发布助手。请结合图片识别出最可能的商品信息，只返回 JSON，不要输出解释。JSON 结构固定为：{"title":"商品名称","category":"分类","tags":["标签1","标签2"],"reason":"一句话识别依据"}。要求：title 简洁准确；category 必须从 [${publishCategories.join('、')}] 中选择；tags 只能从 [${allTagOptions.join('、')}] 中选择，最多 3 个。`
}

/** 把提示词和图片 URL 组装成视觉模型消息内容。 */
function buildImageContent(prompt, imageUrls = []) {
  return [
    { type: 'text', text: prompt },
    ...imageUrls.map((url) => ({ type: 'image_url', image_url: { url } }))
  ]
}

async function readStreamText(res = {}) {
  if (!res || !res.textStream) return getModelText(res)
  let text = ''
  for await (const chunk of res.textStream) {
    text += chunk || ''
  }
  return text
}

Page({
  data: {
    form: {
      title: '',
      description: '',
      price: '',
      category: '',
      tags: [],
      images: []
    },
    categories: publishCategories,
    tagOptions: defaultTagOptions,
    tagTitle: DEFAULT_TAG_TITLE,
    tagHint: DEFAULT_TAG_HINT,
    selectedTagsMap: {},
    imagePreviews: [],
    aiSuggestion: null,
    aiSupported: false,
    aiTip: '识别结果仅作建议，你仍然可以手动修改。',
    loginChecked: false,
    canPublish: false,
    uploading: false,
    submitting: false,
    recognizing: false
  },

  /** 初始化 AI 能力开关。 */
  onLoad() {
    const sdkVersion = wx.getSystemInfoSync().SDKVersion || '0.0.0'
    const aiSupported = compareVersion(sdkVersion, '3.7.1') >= 0 &&
      !!(wx.cloud && wx.cloud.extend && wx.cloud.extend.AI && wx.cloud.extend.AI.createModel)
    this.setData({
      aiSupported,
      aiTip: aiSupported ? '识别结果仅作建议，你仍然可以手动修改。' : '当前环境暂不支持 AI 识别，请手动填写商品信息。'
    })
  },

  /** 页面显示时同步自定义 tabBar，并确认已登录后再允许发布。 */
  onShow() {
    this.syncTabBar()
    this.ensurePublishLogin(true)
  },

  onReady() {
    this.updateTagPanel(this.data.form.category)
  },

  /** 同步自定义 tabBar 的选中项。 */
  syncTabBar() {
    const tabBar = this.getTabBar && this.getTabBar()
    if (tabBar) {
      tabBar.setData({ selected: '/pages/publish/publish' })
    }
  },

  async ensurePublishLogin(showModal = true) {
    const canPublish = await requireLogin({
      title: '先登录再发布',
      content: '完善昵称并保存后，就可以发布校园闲置。',
      from: 'publish',
      silent: !showModal
    })
    this.setData({
      loginChecked: true,
      canPublish
    })
    return canPublish
  },

  goLoginPage() {
    wx.navigateTo({ url: buildLoginUrl('publish') })
  },

  /** 商品标题输入。 */
  onTitleInput(e) {
    this.setData({ 'form.title': e.detail.value })
  },

  /** 商品描述输入。 */
  onDescriptionInput(e) {
    this.setData({ 'form.description': e.detail.value })
  },

  /** 价格输入，只保留数字和两位小数。 */
  onPriceInput(e) {
    this.setData({ 'form.price': normalizePriceInput(e.detail.value) })
  },

  /** 选择商品分类并刷新可选标签。 */
  onSelectCategory(e) {
    const category = e.currentTarget.dataset.category
    this.setData({ 'form.category': category })
    this.updateTagPanel(category)
  },

  /** 选择或取消标签，最多保留 5 个。 */
  onToggleTag(e) {
    const value = e.currentTarget.dataset.tag
    const tags = [...this.data.form.tags]
    const index = tags.indexOf(value)
    if (index > -1) {
      tags.splice(index, 1)
    } else {
      if (tags.length >= 5) {
        wx.showToast({ title: '最多选择 5 个标签', icon: 'none' })
        return
      }
      tags.push(value)
    }
    this.setData({
      'form.tags': tags,
      selectedTagsMap: buildTagMap(tags)
    })
  },

  /**
   * 选择并上传商品图片。
   * 修复点：form.images 保存云 fileID 用于提交，imagePreviews 保存本地临时图用于当前页面预览，避免 cloud:// 直接作为预览 src 造成空图。
   */
  async chooseImages() {
    if (!(await this.ensurePublishLogin(true))) return
    const currentCount = this.data.form.images.length
    if (currentCount >= 3) {
      wx.showToast({ title: '最多上传 3 张图片', icon: 'none' })
      return
    }
    try {
      const chooseRes = await wx.chooseMedia({
        count: 3 - currentCount,
        mediaType: ['image'],
        sourceType: ['album', 'camera']
      })
      const tempFiles = chooseRes.tempFiles || []
      if (!tempFiles.length) return

      this.setData({ uploading: true })
      wx.showLoading({ title: '上传中', mask: true })

      const uploaded = []
      const previews = []
      for (let i = 0; i < tempFiles.length; i += 1) {
        const file = tempFiles[i]
        const fileID = await uploadFileToCloud(file.tempFilePath, 'goods')
        uploaded.push(fileID)
        previews.push(file.tempFilePath)
      }

      const images = [...this.data.form.images, ...uploaded]
      const imagePreviews = [...this.data.imagePreviews, ...previews]
      this.setData({
        'form.images': images,
        imagePreviews
      })
      wx.hideLoading()

      if (images.length && !this.data.aiSuggestion) {
        await this.runAiRecognize(images)
      }
    } catch (error) {
      wx.hideLoading()
      if (error && String(error.errMsg || '').includes('cancel')) return
      console.error('上传图片失败：', error)
      wx.showToast({ title: '图片上传失败', icon: 'none' })
    } finally {
      this.setData({ uploading: false })
    }
  },

  /** 删除某张已选图片，并同步删除提交 fileID 与页面预览图。 */
  removeImage(e) {
    const index = Number(e.currentTarget.dataset.index)
    const images = [...this.data.form.images]
    const imagePreviews = [...this.data.imagePreviews]
    if (!Number.isInteger(index) || index < 0) return
    images.splice(index, 1)
    imagePreviews.splice(index, 1)
    const updateData = {
      'form.images': images,
      imagePreviews
    }
    if (!images.length) {
      updateData.aiSuggestion = null
      updateData.aiTip = '识别结果仅作建议，你仍然可以手动修改。'
    }
    this.setData(updateData)
  },

  /** 调用视觉模型识别商品信息。 */
  async callVisionModel(imageUrls = [], isRetry = false) {
    const messages = [
      {
        role: 'user',
        content: buildImageContent(buildPrompt(isRetry), imageUrls)
      }
    ]
    const candidates = [
      {
        provider: 'hunyuan-custom',
        method: 'streamText',
        payload: { model: 'hunyuan-vision', messages }
      },
      {
        provider: 'hunyuan-exp',
        method: 'generateText',
        payload: { model: 'hunyuan-vision', messages }
      },
      {
        provider: 'cloudbase',
        method: 'generateText',
        payload: { model: 'hunyuan-vision', messages }
      }
    ]
    let lastError = null

    for (let i = 0; i < candidates.length; i += 1) {
      const item = candidates[i]
      try {
        const model = wx.cloud.extend.AI.createModel(item.provider)
        const res = await model[item.method](item.payload)
        const text = await readStreamText(res)
        if (String(text || '').trim()) return text
      } catch (error) {
        lastError = error
      }
    }

    throw lastError || new Error('AI 识别失败')
  },

  /** 基于前两张图片运行 AI 识别并回填建议。 */
  async runAiRecognize(fileIDs) {
    if (!this.data.aiSupported) return
    const recognizeFileIds = (Array.isArray(fileIDs) ? fileIDs : [fileIDs]).filter(Boolean).slice(0, 2)
    if (!recognizeFileIds.length) return

    this.setData({ recognizing: true, aiTip: '正在识别商品名称与分类…' })
    try {
      const tempRes = await wx.cloud.getTempFileURL({ fileList: recognizeFileIds })
      const imageUrls = (tempRes.fileList || [])
        .map((item) => item && item.tempFileURL)
        .filter(Boolean)
        .slice(0, 2)
      if (!imageUrls.length) throw new Error('未获取到图片临时链接')

      let parsedSuggestion = null
      let rawText = ''
      let lastError = null

      for (let i = 0; i < 2; i += 1) {
        try {
          rawText = await this.callVisionModel(imageUrls, i > 0)
          parsedSuggestion = extractJsonFromText(rawText)
          break
        } catch (error) {
          lastError = error
        }
      }

      if (!parsedSuggestion) {
        throw lastError || new Error('AI 识别失败')
      }

      const normalizedSuggestion = normalizeAiSuggestion(parsedSuggestion, rawText)
      const finalCategory = this.data.form.category || normalizedSuggestion.category || ''
      const nextTagOptions = this.getTagOptionsByCategory(finalCategory)
      const mergedTags = uniqueList([...(this.data.form.tags || []), ...(normalizedSuggestion.tags || [])], 5, 12)
        .filter((tag) => nextTagOptions.includes(tag))

      this.setData({
        aiSuggestion: normalizedSuggestion,
        aiTip: normalizedSuggestion.reason || '识别完成，你可以手动修改结果。',
        'form.title': this.data.form.title || normalizedSuggestion.title,
        'form.category': finalCategory,
        tagOptions: nextTagOptions,
        tagTitle: this.getTagTitle(finalCategory),
        tagHint: this.getTagHint(finalCategory),
        'form.tags': mergedTags,
        selectedTagsMap: buildTagMap(mergedTags)
      })
    } catch (error) {
      console.warn('AI 识别失败，自动降级为手动填写：', error)
      this.setData({ aiTip: '暂时无法自动识别，请手动填写商品名称和分类。' })
    } finally {
      this.setData({ recognizing: false })
    }
  },

  /** 校验表单并提交发布。 */
  async submitGoods() {
    if (!(await this.ensurePublishLogin(true))) return
    const { form, submitting } = this.data
    if (submitting) return
    const title = String(form.title || '').trim()
    const description = String(form.description || '').trim()
    if (!form.images.length) {
      wx.showToast({ title: '请至少上传 1 张图片', icon: 'none' })
      return
    }
    if (!title) {
      wx.showToast({ title: '请填写商品名称', icon: 'none' })
      return
    }
    if (title.length > MAX_TITLE_LENGTH) {
      wx.showToast({ title: `商品名称最多 ${MAX_TITLE_LENGTH} 字`, icon: 'none' })
      return
    }
    if (!form.category) {
      wx.showToast({ title: '请选择商品分类', icon: 'none' })
      return
    }
    if (description.length > MAX_DESCRIPTION_LENGTH) {
      wx.showToast({ title: `发布说明最多 ${MAX_DESCRIPTION_LENGTH} 字`, icon: 'none' })
      return
    }

    let price = 0
    try {
      price = parsePrice(form.price)
    } catch (error) {
      wx.showToast({ title: error.message || '价格格式不正确', icon: 'none' })
      return
    }

    this.setData({ submitting: true })
    wx.showLoading({ title: '发布中', mask: true })
    try {
      await createGoods({
        title,
        description,
        price,
        category: form.category,
        tags: form.tags,
        images: form.images,
        aiSuggestion: this.data.aiSuggestion
      })

      wx.hideLoading()
      wx.showToast({ title: '发布成功', icon: 'success' })
      this.resetForm()
      setTimeout(() => {
        wx.switchTab({ url: '/pages/home/home' })
      }, 700)
    } catch (error) {
      wx.hideLoading()
      console.error('发布失败：', error)
      wx.showToast({ title: error.message || '发布失败，请稍后再试', icon: 'none' })
    } finally {
      this.setData({ submitting: false })
    }
  },

  /** 发布成功后重置表单状态。 */
  resetForm() {
    this.setData({
      form: {
        title: '',
        description: '',
        price: '',
        category: '',
        tags: [],
        images: []
      },
      tagOptions: defaultTagOptions,
      tagTitle: DEFAULT_TAG_TITLE,
      tagHint: DEFAULT_TAG_HINT,
      selectedTagsMap: {},
      imagePreviews: [],
      aiSuggestion: null,
      aiTip: '识别结果仅作建议，你仍然可以手动修改。'
    })
  },

  /** 根据分类获取标签候选项。 */
  getTagOptionsByCategory(category) {
    if (category && categoryTagMap[category]) {
      return categoryTagMap[category]
    }
    return defaultTagOptions
  },

  /** 根据分类获取标签模块标题。 */
  getTagTitle(category) {
    return category === '教材资料' ? BOOK_TAG_TITLE : DEFAULT_TAG_TITLE
  },

  /** 根据分类获取标签模块提示。 */
  getTagHint(category) {
    return category === '教材资料' ? BOOK_TAG_HINT : DEFAULT_TAG_HINT
  },

  /** 更新标签面板，并移除不属于当前分类的已选标签。 */
  updateTagPanel(category) {
    const options = this.getTagOptionsByCategory(category)
    const keptTags = (this.data.form.tags || []).filter((tag) => options.includes(tag))
    this.setData({
      tagOptions: options,
      tagTitle: this.getTagTitle(category),
      tagHint: this.getTagHint(category),
      'form.tags': keptTags,
      selectedTagsMap: buildTagMap(keptTags)
    })
  }
})
