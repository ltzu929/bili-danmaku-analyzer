# B站弹幕分析工具

以下为简洁版软件介绍与安装包使用教程，便于快速上手。

## 软件简介
- 一款用于分析 B 站视频与直播回放弹幕的桌面应用，支持热词统计、密度曲线、UP 主合集一键分析。

## 主要功能
- 弹幕分析：按时间区间统计弹幕数量，查看趋势曲线与悬浮窗热词（前五，自动合并相似）。
- UP 主合集：粘贴合集链接，自动展示最新 5 个直播回放，点击卡片即可开始分析。
- 历史记录：自动保存查询历史，支持拖拽排序与删除，重启后自动恢复。
- 版本更新：设置页支持“检查更新”，下载后可一键安装新版。

## 安装包使用教程（Windows）
1. 前往 GitHub Releases 页面，下载最新安装包（Windows NSIS）。
2. 双击安装包，选择安装目录并完成安装。
3. 启动软件后进入主界面即可使用。

## 首次使用
1. 打开“UP 主合集”页，粘贴 B 站合集链接（示例：`https://space.bilibili.com/{mid}/lists/{sid}?type=series`）。
2. 点击“加载合集内容”，选择一个直播回放卡片，自动跳转到分析页并开始分析。
3. 悬浮窗显示当前时间段的热门弹幕（前五），可在设置里调整显示数量与时间窗口。

## 更新升级
1. 打开“设置”页，点击“检查更新”。
2. 下载过程中显示进度条与百分比。
3. 下载完成后点击“安装更新”，自动退出并安装新版。

## 常见问题
- 安装失败：请以管理员身份运行安装包，或更换安装目录后重试。
- 更新未检测到：确认网络正常，且最新版本已在 Releases 发布。
- 封面不显示：由浏览器策略导致，应用已内置同源代理；若仍异常可稍后重试。
 - 音频转换失败：请检查“设置”页中的腾讯云凭证与 COS Bucket/Region 是否配置正确，确认 Bucket 可访问。

## 反馈与开源
- 问题反馈与建议请到 Issues 提交：`https://github.com/ltzu929/bili-danmaku-analyzer/issues`
- 欢迎 Star 与贡献代码！

> 🎯 智能分析B站视频弹幕，快速定位精彩片段

[![React](https://img.shields.io/badge/React-18-blue.svg)](https://reactjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue.svg)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-6-blue.svg)](https://vitejs.dev/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-3-blue.svg)](https://tailwindcss.com/)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

---

## ⭐ Star历史
[![Star History Chart](https://api.star-history.com/svg?repos=ltzu929/bili-danmaku-analyzer&type=Date)](https://star-history.com/#ltzu929/bili-danmaku-analyzer&Date)
