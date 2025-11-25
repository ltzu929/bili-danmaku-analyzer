# 项目结构说明

## 📁 目录结构

```
bilibili-danmaku-analyzer/
├── .github/                    # GitHub相关配置
│   └── workflows/             # GitHub Actions工作流
│       └── ci-cd.yml         # CI/CD配置
├── api/                        # 后端API服务
│   ├── server.js              # Express服务器主文件
│   ├── test-real-danmaku.js   # 真实弹幕数据测试
│   ├── test_danmaku.mjs     # 弹幕测试模块
│   └── test_frontend.mjs      # 前端API测试
├── docs/                       # 项目文档
│   └── DEMO.md               # 功能演示文档
├── public/                     # 静态资源
│   └── favicon.svg           # 网站图标
├── src/                        # 前端源代码
│   ├── assets/               # 静态资源
│   │   └── react.svg         # React图标
│   ├── components/           # React组件
│   │   ├── ui/              # 基础UI组件
│   │   │   ├── alert.tsx    # 警告组件
│   │   │   ├── button.tsx   # 按钮组件
│   │   │   ├── card.tsx     # 卡片组件
│   │   │   ├── input.tsx    # 输入框组件
│   │   │   ├── label.tsx    # 标签组件
│   │   │   └── textarea.tsx # 文本域组件
│   │   ├── AudioText.tsx    # 音频文本组件
│   │   ├── ChartControls.tsx # 图表控制面板
│   │   ├── DanmakuAnalysis.tsx # 弹幕分析组件
│   │   ├── DanmakuChart.tsx # 弹幕图表组件（核心）
│   │   ├── Empty.tsx        # 空状态组件
│   │   ├── KeywordSearch.tsx # 关键词搜索组件
│   │   ├── MainApp.tsx      # 主应用组件
│   │   ├── SidebarLayout.tsx # 侧边栏布局
│   │   └── UPVideos.tsx     # UP主视频组件
│   ├── hooks/                # 自定义Hooks
│   │   └── useTheme.ts      # 主题Hook
│   ├── lib/                  # 工具库
│   │   └── utils.ts         # 工具函数
│   ├── pages/               # 页面组件
│   │   ├── AnalysisPage.tsx # 分析页面
│   │   ├── Home.tsx         # 首页
│   │   ├── HomePage.tsx     # 主页
│   │   ├── LandingPage.tsx  # 着陆页
│   │   └── VideoAnalysisPage.tsx # 视频分析页面（核心）
│   ├── App.tsx              # 应用主组件
│   ├── index.css            # 全局样式
│   ├── main.tsx             # 应用入口
│   └── vite-env.d.ts        # Vite环境类型定义
├── .gitignore               # Git忽略文件
├── .gitattributes           # Git属性配置
├── CONTRIBUTING.md          # 贡献指南
├── LICENSE                  # MIT许可证
├── README.md                # 项目说明
├── audio_text.py            # 音频文本处理脚本
├── config.ini               # 配置文件
├── eslint.config.js         # ESLint配置
├── index.html               # HTML入口文件
├── package-lock.json        # NPM依赖锁定
├── package.json             # 项目配置
├── postcss.config.js      # PostCSS配置
├── tailwind.config.js     # Tailwind CSS配置
├── test_api.mjs            # API测试
├── test_danmaku.js         # 弹幕测试
├── tsconfig.json           # TypeScript配置
└── vite.config.ts          # Vite配置
```

## 🎯 核心文件说明

### 前端核心组件

#### `src/components/DanmakuChart.tsx`
**功能**: 弹幕图表可视化组件
**特点**:
- 📊 1分钟间隔弹幕统计图表
- 🎯 鼠标跟随热门弹幕悬浮窗
- 📈 多维度数据展示（总数、中文、英文、表情）
- 🎨 现代化的Recharts图表

#### `src/pages/VideoAnalysisPage.tsx`
**功能**: 视频分析主页面
**特点**:
- 📱 响应式布局设计
- 🎨 毛玻璃效果和渐变配色
- 📊 集成图表和控制面板
- 💾 数据导出和分享功能

### 后端核心文件

#### `api/server.js`
**功能**: Express后端服务器
**特点**:
- 🔌 提供B站API代理服务
- 📊 弹幕数据获取和处理
- 🔒 CORS跨域支持
- ⚡ 高性能数据处理

## 🚀 开发指南

### 快速开始
```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev

# 构建生产版本
npm run build
```

### 开发规范
1. **组件开发**: 遵循单一职责原则
2. **类型安全**: 使用TypeScript严格类型检查
3. **代码风格**: 遵循ESLint配置
4. **性能优化**: 使用React.memo和useMemo
5. **中文注释**: 重要逻辑添加中文注释

### 文件命名规范
- **组件文件**: PascalCase，如 `DanmakuChart.tsx`
- **工具函数**: camelCase，如 `formatTime.ts`
- **常量定义**: UPPER_SNAKE_CASE，如 `MAX_DANMAKU_COUNT`
- **样式文件**: 与组件同名，如 `DanmakuChart.css`

## 📊 技术栈

### 前端技术
- **框架**: React 18 + TypeScript
- **构建工具**: Vite 6
- **样式**: Tailwind CSS + PostCSS
- **图表**: Recharts
- **图标**: Lucide React

### 后端技术
- **运行时**: Node.js + Express
- **数据来源**: B站官方API
- **数据处理**: 自定义聚合算法

### 开发工具
- **代码检查**: ESLint
- **类型检查**: TypeScript
- **包管理**: npm
- **版本控制**: Git

## 🎯 功能特色

### 核心功能
1. **弹幕密度分析**: 1分钟间隔统计，识别高峰时段
2. **热门弹幕识别**: ±30秒时间窗口，智能提取Top 10
3. **鼠标跟随悬浮窗**: 实时显示当前时间点热门弹幕
4. **多维度筛选**: 支持中文、英文、表情弹幕分别统计
5. **数据导出**: JSON格式导出分析结果

### 设计亮点
- **现代化UI**: 毛玻璃效果，渐变配色
- **响应式设计**: 完美适配移动端
- **流畅动画**: 平滑过渡效果
- **用户友好**: 直观的交互设计

## 🔮 扩展计划

### 即将实现
- 🎮 游戏精彩片段自动提取
- 📊 词云可视化展示
- 🤖 AI弹幕情感分析
- 📱 移动端原生应用

### 长期愿景
- 🌐 多平台支持（抖音、快手等）
- 👥 社区分享功能
- 📈 高级数据分析
- 🔧 API服务开放

---

**⭐ 如果这个项目对你有帮助，请给个Star支持一下！**