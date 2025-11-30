import express from 'express';
import cors from 'cors';
import axios from 'axios';
import xml2js from 'xml2js';
import cron from 'node-cron';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import multer from 'multer';
import COS from 'cos-nodejs-sdk-v5';
import tencentcloud from 'tencentcloud-sdk-nodejs';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// ==========================================
// 配置与常量定义
// ==========================================

// 定义数据存储的根目录，放在用户的主目录下，确保跨平台兼容性
const USER_DATA_DIR = path.join(os.homedir(), '.bili-danmaku-analyzer-data');

// 获取当前文件的路径和目录名（ES模块环境）
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 配置文件路径
const CONFIG_FILE_PATH = path.join(USER_DATA_DIR, 'config.ini');

// 初始化Express应用
const app = express();
const PORT = 3001;

// 中间件配置
app.use(cors()); // 允许跨域请求
app.use(express.json()); // 解析JSON请求体
const upload = multer(); // 处理文件上传

// ==========================================
// 内存数据存储
// ==========================================

// 存储弹幕数据的内存缓存，避免重复请求
let danmakuData = {};
// UP主合集数据的内存缓存
let upSeriesCache = {};

// 历史记录存储路径配置
const historyDir = USER_DATA_DIR;
const historyFile = path.join(historyDir, 'up_history.json');

// 音频监控进程和日志存储
let audioWatchProc = null;
let audioWatchLog = [];

// ==========================================
// 辅助工具函数
// ==========================================

/**
 * 读取历史记录文件
 * @returns {Promise<Array>} 历史记录数组
 */
async function readHistory() {
  try {
    // 确保目录存在
    await fs.mkdir(historyDir, { recursive: true });
    // 读取文件内容
    const buf = await fs.readFile(historyFile, 'utf-8');
    const arr = JSON.parse(buf);
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    // 文件不存在或解析失败时返回空数组
    return [];
  }
}

/**
 * 写入历史记录文件
 * @param {Array} arr - 要写入的历史记录数组
 */
async function writeHistory(arr) {
  await fs.mkdir(historyDir, { recursive: true });
  await fs.writeFile(historyFile, JSON.stringify(arr, null, 2), 'utf-8');
}

/**
 * 统一封面URL格式
 * 处理协议补齐（// -> https://）和HTTP转HTTPS
 * @param {string} u - 原始URL
 * @returns {string} 规范化后的URL
 */
function normalizeCoverUrl(u) {
  if (!u) return '';
  let s = String(u).trim();
  if (s.startsWith('//')) return 'https:' + s;
  if (s.startsWith('http://')) return s.replace('http://', 'https://');
  return s;
}

/**
 * 解析INI格式配置文件
 * @param {string} text - INI文件内容
 * @returns {Object} 解析后的配置对象
 */
function parseIni(text) {
  const out = {};
  let section = '';
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    // 跳过空行和注释
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    // 解析节（Section）
    const mSec = line.match(/^\[(.+?)\]$/);
    if (mSec) { section = mSec[1].toLowerCase(); if (!out[section]) out[section] = {}; continue; }
    // 解析键值对
    const idx = line.indexOf('=');
    if (idx > 0) {
      const k = line.slice(0, idx).trim();
      const v = line.slice(idx + 1).trim();
      if (!out[section]) out[section] = {};
      out[section][k] = v;
    }
  }
  return out;
}

/**
 * 获取语音识别(ASR)配置
 * 优先从环境变量获取，其次从配置文件获取
 * @returns {Promise<Object>} 配置对象
 */
async function getASRConfig() {
  let ini = {};
  try {
    const s = await fs.readFile(CONFIG_FILE_PATH, 'utf-8');
    ini = parseIni(s);
  } catch {}
  const env = process.env;
  // 兼容不同的配置节名称
  const auth = ini.auth || ini.TencentCloud || {};
  const cos = ini.cos || {};
  const asr = ini.asr || {};
  
  // 提取配置项
  const SecretId = env.TC_SECRET_ID || auth.SecretId || '';
  const SecretKey = env.TC_SECRET_KEY || auth.SecretKey || '';
  const Region = env.TC_REGION || auth.Region || cos.Region || asr.Region || '';
  const Bucket = env.TC_COS_BUCKET || auth.Bucket || cos.Bucket || '';
  const EngineModelType = env.TC_ASR_ENGINE || asr.EngineModelType || '16k_zh';
  
  return { SecretId, SecretKey, Region, Bucket, EngineModelType };
}

// ==========================================
// B站视频弹幕处理逻辑
// ==========================================

/**
 * 获取B站视频弹幕数据（通过CID方式）
 * 流程：BV号 -> CID -> 弹幕XML
 * @param {string} bvid - 视频BV号
 * @returns {Promise<string|null>} 弹幕XML字符串或null
 */
async function fetchVideoDanmakuByCID(bvid) {
  try {
    // 1. 获取视频详情以得到CID
    const cidResponse = await axios.get(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    if (!cidResponse.data || !cidResponse.data.data || !cidResponse.data.data.cid) {
      console.error('无法获取视频CID');
      return null;
    }
    
    const cid = cidResponse.data.data.cid;
    console.log('获取到视频CID:', cid);
    
    // 2. 根据CID获取弹幕XML数据
    const danmakuUrl = `https://api.bilibili.com/x/v1/dm/list.so?oid=${cid}`;
    const danmakuResponse = await axios.get(danmakuUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      responseType: 'arraybuffer' // 关键：弹幕数据可能包含特殊字符，需以二进制接收
    });
    
    // 3. 将二进制数据转换为UTF-8字符串
    const xmlData = Buffer.from(danmakuResponse.data).toString('utf-8');
    console.log('成功获取弹幕数据，长度:', xmlData.length);
    
    return xmlData;
  } catch (error) {
    console.error('获取视频弹幕数据失败:', error.message);
    return null;
  }
}

/**
 * 解析B站视频弹幕XML数据
 * @param {string} xmlData - XML格式的弹幕数据
 * @returns {Promise<Array>} 解析后的弹幕对象数组
 */
async function parseVideoDanmakuXML(xmlData) {
  try {
    const parser = new xml2js.Parser();
    const result = await parser.parseStringPromise(xmlData);
    
    const danmakus = [];
    
    // B站视频弹幕XML结构：<i><d p="..."></d></i>
    if (result && result.i && result.i.d) {
      result.i.d.forEach(danmaku => {
        // p属性格式：出现时间,类型,字号,颜色,时间戳,弹幕池,用户ID,弹幕ID
        const attr = danmaku.$.p.split(',');
        danmakus.push({
          time: parseFloat(attr[0]), // 视频内出现时间（秒）
          type: parseInt(attr[1]),   // 弹幕类型（滚动、顶部、底部等）
          size: parseInt(attr[2]),   // 字体大小
          color: parseInt(attr[3]),  // 颜色值（十进制）
          timestamp: parseInt(attr[4]), // 发送时间戳（Unix时间戳）
          pool: parseInt(attr[5]),   // 弹幕池类型
          uid: attr[6] || '',        // 发送者用户ID（Hash后）
          id: attr[7] || '',         // 弹幕唯一ID
          text: danmaku._ || ''       // 弹幕文本内容
        });
      });
    }
    
    console.log('成功解析弹幕数量:', danmakus.length);
    return danmakus;
  } catch (error) {
    console.error('解析视频弹幕XML失败:', error.message);
    return [];
  }
}

/**
 * 解析B站URL，提取关键信息（支持直播回放和普通视频）
 * @param {string} url - 输入的URL
 * @returns {Promise<Object>} 解析结果，包含roomId, bvid, date等
 */
async function parseLiveReplayUrl(url) {
  try {
    let realUrl = url;
    
    // 1. 处理b23.tv短链接重定向
    if (url.includes('b23.tv')) {
      try {
        console.log('检测到短链接，开始解析:', url);
        const response = await axios.head(url, {
          maxRedirects: 5,
          validateStatus: (status) => status >= 200 && status < 400
        });
        realUrl = response.request.res.responseUrl || url;
        console.log('短链接解析结果:', realUrl);
      } catch (error) {
        console.error('解析短链接失败:', error.message);
        return { error: '短链接解析失败: ' + error.message };
      }
    }
    
    console.log('解析URL:', realUrl);
    
    // 初始化返回变量
    let roomId = null;
    let date = null;
    let bvid = null;
    let videoTitle = '';
    let videoOwner = null;
    let videoCover = '';
    
    // 2. 尝试匹配直播回放URL格式: https://live.bilibili.com/record/ROOMID
    const recordMatch = realUrl.match(/live\.bilibili\.com\/record\/(\d+)/);
    if (recordMatch) {
      roomId = recordMatch[1];
      console.log('检测到直播回放格式，房间ID:', roomId);
      // 不再获取直播间信息
    }
    
    // 3. 如果不是直播回放，尝试匹配普通视频BV号
    const bvMatch = realUrl.match(/BV[a-zA-Z0-9]+/);
    if (bvMatch && !roomId) {
      bvid = bvMatch[0];
      console.log('检测到BV号:', bvid);
      
      // 获取视频详细信息
      const videoInfo = await getVideoInfo(bvid);
      if (videoInfo && videoInfo.data) {
        console.log('视频信息获取成功');
        
        // 提取视频元数据
        const title = videoInfo.data.title || '';
        const desc = videoInfo.data.desc || '';
        videoTitle = title;
        videoOwner = videoInfo.data.owner;
        videoCover = videoInfo.data.pic || '';
        
        console.log('视频标题:', title);
        console.log('视频描述:', desc.substring(0, 100));
        
        // 从视频发布时间推算日期
        if (videoInfo.data.pubdate) {
          try {
            const pubDate = new Date(videoInfo.data.pubdate * 1000);
            date = pubDate.toISOString().split('T')[0];
            console.log('获取到视频发布日期:', date);
          } catch (dateError) {
            console.error('日期格式化失败:', dateError);
            date = new Date().toISOString().split('T')[0];
          }
        }
        
        console.log('将使用视频弹幕API获取数据');
      } else {
        console.log('无法获取视频信息');
        return { error: '无法获取视频信息，请确认BV号正确' };
      }
    }
    
    // 4. 验证解析结果
    if (!roomId && !bvid) {
      console.log('无法提取房间ID或BV号');
      return { error: '无法从URL中提取视频信息，请确认是B站视频链接' };
    }
    
    // 兜底日期处理
    if (!date) {
      console.log('无法确定日期，使用当前日期作为备选');
      date = new Date().toISOString().split('T')[0];
    }
    
    console.log('解析结果 - 房间ID:', roomId, 'BV号:', bvid, '日期:', date);
    return { roomId, bvid, date, realUrl, videoTitle, videoOwner, videoCover };
  } catch (error) {
    console.error('解析URL失败:', error.message);
    return { error: 'URL解析失败: ' + error.message };
  }
}

/**
 * 获取视频详细信息
 * @param {string} bvid - 视频BV号
 * @returns {Promise<Object|null>} 视频信息对象或null
 */
async function getVideoInfo(bvid) {
  try {
    const response = await axios.get(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    return response.data;
  } catch (error) {
    console.error('获取视频信息失败:', error.message);
    return null;
  }
}

// API端点：获取视频封面（供前端兜底调用）
app.get('/api/video/:bvid', async (req, res) => {
  try {
    const { bvid } = req.params;
    const vinfo = await getVideoInfo(bvid);
    const cover = vinfo && vinfo.data && vinfo.data.pic ? normalizeCoverUrl(vinfo.data.pic) : '';
    if (!cover) {
      return res.status(404).json({ error: '未找到封面' });
    }
    res.json({ cover });
  } catch (e) {
    res.status(500).json({ error: '获取封面失败' });
  }
});

/**
 * 获取UP主个人信息
 * @param {string} mid - UP主ID (Member ID)
 * @returns {Promise<Object|null>} UP主信息对象或null
 */
async function getUPInfo(mid) {
  try {
    const response = await axios.get(`https://api.bilibili.com/x/space/acc/info?mid=${mid}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    return response.data;
  } catch (error) {
    console.error('获取UP主信息失败:', error.message);
    return null;
  }
}

/**
 * 获取B站直播回放弹幕数据
 * 尝试使用多个API端点以获取最完整的数据
 * @param {string} roomId - 直播间ID
 * @param {string} date - 直播日期 (格式: YYYY-MM-DD)
 * @returns {Promise<Object|null>} 弹幕数据对象或null
 */
async function fetchDanmakuXML(roomId, date) {
  try {
    // 1. 尝试使用gethistory接口
    const xmlUrl = `https://api.live.bilibili.com/xlive/web-room/v1/dM/gethistory?roomid=${roomId}&date=${date}`;
    
    const response = await axios.get(xmlUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    // 检查响应数据
    if (response.data && response.data.code === 0 && response.data.data) {
      const data = response.data.data;
      
      // 如果返回的是直接的房间弹幕列表
      if (data.room && data.room[0] && data.room[0].danmaku) {
        console.log('获取到房间弹幕列表，数量:', data.room[0].danmaku.length);
        return response.data;
      }
      
      // 如果返回的是聚合数据，尝试获取更详细的列表
      console.log('获取到聚合数据，尝试获取详细弹幕...');
      
      // 2. 尝试使用getDMMsgList接口获取详细数据
      const detailUrl = `https://api.live.bilibili.com/xlive/web-room/v1/dM/getDMMsgList?roomid=${roomId}&date=${date}`;
      try {
        const detailResponse = await axios.get(detailUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          }
        });
        
        if (detailResponse.data && detailResponse.data.code === 0) {
          console.log('成功获取详细弹幕数据');
          return detailResponse.data;
        }
      } catch (detailError) {
        console.log('获取详细弹幕数据失败，使用原始数据');
      }
    }

    return response.data;
  } catch (error) {
    console.error('获取直播回放弹幕数据失败:', error.message);
    return null;
  }
}

/**
 * 解析直播回放XML弹幕数据
 * @param {string} xmlData - XML格式的直播回放弹幕数据
 * @returns {Promise<Array>} 解析后的弹幕对象数组
 */
async function parseDanmakuXML(xmlData) {
  try {
    console.log('原始XML数据长度:', xmlData.length);
    // 仅打印前500字符用于调试，避免日志过大
    console.log('XML数据前500字符:', xmlData.substring(0, 500));
    
    const parser = new xml2js.Parser();
    const result = await parser.parseStringPromise(xmlData);
    
    const danmakus = [];
    
    if (result && result.i && result.i.d) {
      console.log('找到弹幕数量:', result.i.d.length);
      
      result.i.d.forEach((danmaku, index) => {
        const attr = danmaku.$.p.split(',');
        const time = parseFloat(attr[0]);
        
        // 调试：打印前5条弹幕的时间戳信息
        if (index < 5) {
          console.log(`弹幕${index}: time=${time}, attr=${attr[0]}`);
        }
        
        danmakus.push({
          time: time, // 相对直播开始的时间（秒）
          type: parseInt(attr[1]),   // 弹幕类型
          size: parseInt(attr[2]),   // 字体大小
          color: parseInt(attr[3]),  // 颜色
          timestamp: parseInt(attr[4]), // 发送时间戳
          pool: parseInt(attr[5]),   // 弹幕池
          uid: attr[6],             // 用户ID
          id: attr[7],              // 弹幕ID
          text: danmaku._ || ''      // 弹幕内容
        });
      });
    }
    
    // 检查时间戳分布情况，用于调试数据质量
    if (danmakus.length > 0) {
      const timestamps = danmakus.map(d => d.time).sort((a, b) => a - b);
      const uniqueTimestamps = [...new Set(timestamps)];
      console.log('唯一时间戳数量:', uniqueTimestamps.length);
      console.log('前10个时间戳:', uniqueTimestamps.slice(0, 10));
      
      // 计算并打印前20个时间间隔
      const intervals = [];
      for (let i = 1; i < Math.min(20, uniqueTimestamps.length); i++) {
        intervals.push(uniqueTimestamps[i] - uniqueTimestamps[i-1]);
      }
      console.log('前20个时间间隔:', intervals);
    }
    
    return danmakus;
  } catch (error) {
    console.error('解析直播回放XML失败:', error.message);
    return [];
  }
}

// ==========================================
// 数据分析逻辑
// ==========================================

/**
 * 分析弹幕数据，生成时间轴统计信息
 * @param {Array} danmakus - 弹幕数组
 * @param {number} interval - 统计时间间隔（秒），默认60秒
 * @returns {Array} 排序后的统计数据数组
 */
function analyzeDanmakuData(danmakus, interval = 60) {
  const stats = {};
  
  // 1. 按时间间隔分组统计
  danmakus.forEach(danmaku => {
    // 计算所属时间段
    const timeSlot = Math.floor(danmaku.time / interval) * interval;
    const key = `${timeSlot}-${timeSlot + interval}`;
    
    if (!stats[key]) {
      stats[key] = {
        startTime: timeSlot,
        endTime: timeSlot + interval,
        count: 0,
        chineseCount: 0,
        englishCount: 0,
        withEmoji: 0,
        peak: false
      };
    }
    
    stats[key].count++;
    
    // 2. 内容分类统计
    // 包含中文字符
    if (/[\u4e00-\u9fa5]/.test(danmaku.text)) {
      stats[key].chineseCount++;
    }
    // 包含英文字符
    if (/[a-zA-Z]/.test(danmaku.text)) {
      stats[key].englishCount++;
    }
    // 包含Emoji表情
    if (/[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/u.test(danmaku.text)) {
      stats[key].withEmoji++;
    }
  });
  
  // 3. 识别高峰时段
  const counts = Object.values(stats).map(s => s.count);
  const avgCount = counts.reduce((a, b) => a + b, 0) / counts.length;
  const threshold = avgCount * 1.5; // 阈值：超过平均值1.5倍视为高峰
  
  Object.values(stats).forEach(stat => {
    stat.peak = stat.count > threshold;
  });
  
  // 4. 按时间顺序排序返回
  return Object.values(stats).sort((a, b) => a.startTime - b.startTime);
}

/**
 * 提取弹幕热词
 * 使用简单的分词和停用词过滤
 * @param {Array} danmakus - 弹幕数组
 * @returns {Promise<Array>} 热词列表（前20个）
 */
async function extractKeywords(danmakus) {
  try {
    const wordCount = {};
    // 常用中文停用词列表
    const stopWords = new Set(['的', '了', '在', '是', '我', '你', '他', '她', '它', '们', '这', '那', '有', '就', '不', '人', '都', '一', '一个', '上', '也', '很', '到', '说', '要', '去', '和', '与', '或', '但', '而', '因为', '所以', '如果', '虽然', '然而', '啊', '吧', '呢', '吗', '哈', '哈哈', '哈哈哈']);
    
    danmakus.forEach(d => {
      // 简单的中文分词：按字符分割，过滤掉非中文、标点符号和停用词
      // 注意：这里使用的是简单的单字分词，对于复杂词汇可能不够准确，但对于弹幕这种短文本通常足够
      const words = d.text.split('').filter(char => 
        /[\u4e00-\u9fa5]/.test(char) && !stopWords.has(char) && char.length > 0
      );
      
      words.forEach(word => {
        wordCount[word] = (wordCount[word] || 0) + 1;
      });
    });
    
    // 转换为关键词列表并按频率排序
    const keywords = Object.entries(wordCount)
      .map(([word, count]) => ({
        word,
        weight: count / danmakus.length, // 简单的权重计算：出现频率
        count
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20); // 取前20个关键词
    
    return keywords;
  } catch (error) {
    console.error('关键词提取失败:', error);
    return [];
  }
}

// ==========================================
// API 路由定义
// ==========================================

/**
 * API: 获取直播回放弹幕数据并进行分析
 * 路径: /api/danmaku/:roomId/:date
 * 方法: GET
 */
app.get('/api/danmaku/:roomId/:date', async (req, res) => {
  const { roomId, date } = req.params;
  
  try {
    const cacheKey = `${roomId}-${date}`;
    
    // 1. 检查内存缓存，如果有直接返回
    if (danmakuData[cacheKey]) {
      return res.json(danmakuData[cacheKey]);
    }
    
    // 2. 获取原始XML数据
    const xmlData = await fetchDanmakuXML(roomId, date);
    if (!xmlData) {
      return res.status(404).json({ error: '无法获取弹幕数据' });
    }
    
    // 3. 解析XML为JSON对象数组
    const danmakus = await parseDanmakuXML(xmlData);
    
    // 4. 执行数据分析
    console.log('分析数据，弹幕数量:', danmakus.length);
    
    // 调试日志：检查弹幕时间戳分布
    if (danmakus.length > 0) {
      const timestamps = danmakus.map(d => d.time).sort((a, b) => a - b);
      console.log('弹幕时间范围:', timestamps[0], '到', timestamps[timestamps.length - 1]);
      console.log('前10个时间戳:', timestamps.slice(0, 10));
      console.log('后10个时间戳:', timestamps.slice(-10));
    }
    
    // 生成时间轴统计数据
    const stats = analyzeDanmakuData(danmakus);
    console.log('分析结果，统计段数量:', stats.length);
    
    if (stats.length > 0) {
      console.log('第一个统计段:', stats[0]);
      console.log('最后一个统计段:', stats[stats.length - 1]);
      
      // 检查统计段的时间间隔一致性
      console.log('统计段时间间隔检查:');
      for (let i = 0; i < Math.min(5, stats.length); i++) {
        const stat = stats[i];
        console.log(`段${i}: ${stat.startTime}-${stat.endTime} (${stat.endTime - stat.startTime}秒), 弹幕数: ${stat.count}`);
      }
    }
    
    // 提取热词
    const keywords = await extractKeywords(danmakus);
    
    // 5. 构造最终结果对象
    const result = {
      roomId,
      date,
      totalDanmakus: danmakus.length,
      danmakus,
      stats,
      keywords,
      generatedAt: new Date().toISOString()
    };
    
    // 6. 存入缓存
    danmakuData[cacheKey] = result;
    
    res.json(result);
  } catch (error) {
    console.error('处理直播回放弹幕数据失败:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

/**
 * API: 搜索直播回放弹幕
 * 路径: /api/danmaku/search/:roomId/:date
 * 方法: GET
 * 参数: keyword (查询参数)
 */
app.get('/api/danmaku/search/:roomId/:date', async (req, res) => {
  const { roomId, date } = req.params;
  const { keyword } = req.query;
  
  if (!keyword) {
    return res.status(400).json({ error: '缺少搜索关键词' });
  }
  
  try {
    const cacheKey = `${roomId}-${date}`;
    let danmakus = [];
    
    // 优先从缓存获取数据
    if (danmakuData[cacheKey]) {
      danmakus = danmakuData[cacheKey].danmakus;
    } else {
      // 如果没有缓存，重新获取并解析
      const xmlData = await fetchDanmakuXML(roomId, date);
      if (xmlData) {
        danmakus = await parseDanmakuXML(xmlData);
      }
    }
    
    // 执行搜索过滤（不区分大小写）
    const results = danmakus.filter(d => 
      d.text.toLowerCase().includes(keyword.toLowerCase())
    );
    
    res.json({
      keyword,
      results,
      total: results.length
    });
  } catch (error) {
    console.error('搜索直播回放弹幕失败:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});



/**
 * API: 代理获取图片（解决防盗链问题）
 * 路径: /api/cover
 * 方法: GET
 * 参数: url (查询参数)
 */
app.get('/api/cover', async (req, res) => {
  try {
    const url = req.query.url;
    if (!url || typeof url !== 'string') {
      return res.status(400).send('missing url');
    }
    // 请求图片并转发
    const response = await axios.get(url, { responseType: 'arraybuffer', headers: { 'User-Agent': 'Mozilla/5.0' } });
    
    // 根据扩展名设置Content-Type
    const ext = (url.split('.').pop() || '').toLowerCase();
    const type = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
    
    res.setHeader('Content-Type', type);
    res.send(response.data);
  } catch (e) {
    res.status(502).send('fetch cover failed');
  }
});

/**
 * API: 获取系统默认下载路径
 * 路径: /api/system/downloads-path
 * 方法: GET
 */
app.get('/api/system/downloads-path', async (req, res) => {
  try {
    const home = os.homedir();
    const downloads = path.join(home, 'Downloads');
    res.json({ path: downloads });
  } catch (e) {
    res.status(500).json({ error: 'failed to get downloads path' });
  }
});

/**
 * API: 保存封面图片到本地
 * 路径: /api/save-cover
 * 方法: POST
 * 参数: url, bvid, dir
 */
app.post('/api/save-cover', async (req, res) => {
  try {
    const { url, bvid, dir } = req.body || {};
    if (!url || typeof url !== 'string') return res.status(400).json({ error: 'missing url' });
    
    // 确定目标目录，默认为用户下载目录
    const targetDir = (typeof dir === 'string' && dir.trim()) ? dir.trim() : path.join(os.homedir(), 'Downloads');
    await fs.mkdir(targetDir, { recursive: true });
    
    // 下载图片数据
    const response = await axios.get(url, { responseType: 'arraybuffer', headers: { 'User-Agent': 'Mozilla/5.0' } });
    
    // 确定文件扩展名
    const ct = (response.headers && (response.headers['content-type'] || response.headers['Content-Type'])) || '';
    let ext = 'jpg';
    if (ct.includes('png')) ext = 'png'; else if (ct.includes('webp')) ext = 'webp'; else if (ct.includes('jpeg')) ext = 'jpg';
    else {
      const ex = (url.split('.').pop() || '').toLowerCase();
      if (['png', 'jpg', 'jpeg', 'webp'].includes(ex)) ext = ex;
    }
    
    // 生成文件名并保存
    const filename = `cover_${String(bvid || Date.now())}.${ext}`;
    const filePath = path.join(targetDir, filename);
    await fs.writeFile(filePath, response.data);
    
    res.json({ ok: true, path: filePath });
  } catch (e) {
    res.status(500).json({ error: 'save cover failed' });
  }
});

/**
 * API: 音频转文字 (ASR)
 * 路径: /api/audio-to-text
 * 方法: POST
 * 参数: audio (文件上传)
 * 流程: 上传到COS -> 调用腾讯云ASR -> 轮询结果 -> 生成SRT字幕
 */
app.post('/api/audio-to-text', upload.single('audio'), async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'missing audio' });
    
    // 获取配置
    const cfg = await getASRConfig();
    if (!cfg.SecretId || !cfg.SecretKey || !cfg.Region || !cfg.Bucket) return res.status(400).json({ error: 'missing credentials' });
    
    // 初始化COS客户端
    const cos = new COS({ SecretId: cfg.SecretId, SecretKey: cfg.SecretKey });
    const key = `asr/${Date.now()}_${String(file.originalname || 'audio').replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    
    // 1. 上传音频文件到COS
    await new Promise((resolve, reject) => {
      cos.putObject({ Bucket: cfg.Bucket, Region: cfg.Region, Key: key, StorageClass: 'STANDARD', Body: file.buffer }, (err, data) => {
        if (err) reject(err); else resolve(data);
      });
    });
    
    // 获取带签名的文件URL
    const signed = cos.getObjectUrl({ Bucket: cfg.Bucket, Region: cfg.Region, Key: key, Sign: true, Expires: 3600 });
    
    // 2. 创建录音识别任务
    const AsrClient = tencentcloud.asr.v20190614.Client;
    const client = new AsrClient({ credential: { secretId: cfg.SecretId, secretKey: cfg.SecretKey }, region: cfg.Region, profile: { httpProfile: { endpoint: 'asr.tencentcloudapi.com' } } });
    const create = await client.CreateRecTask({ EngineModelType: cfg.EngineModelType, ChannelNum: 1, ResTextFormat: 3, SourceType: 0, Url: signed });
    const taskId = create.Data.TaskId;
    
    // 3. 轮询任务状态
    let resultDetail = null;
    const started = Date.now();
    while (Date.now() - started < 10 * 60 * 1000) { // 最多等待10分钟
      const st = await client.DescribeTaskStatus({ TaskId: taskId });
      const s = st.Data.StatusStr || st.Data.Status || '';
      if (String(s).toLowerCase() === 'success') { resultDetail = st.Data.ResultDetail || []; break; }
      if (String(s).toLowerCase() === 'failed') { break; }
      await new Promise(r => setTimeout(r, 5000)); // 每5秒轮询一次
    }
    
    // 清理COS文件
    try { cos.deleteObject({ Bucket: cfg.Bucket, Region: cfg.Region, Key: key }, () => {}); } catch {}
    
    if (!resultDetail || !Array.isArray(resultDetail) || resultDetail.length === 0) return res.status(500).json({ error: 'recognition failed' });
    
    // 4. 格式化为SRT字幕
    const fmt = (ms) => {
      const total = Math.floor(Number(ms) || 0);
      const hh = Math.floor(total / 3600000);
      const mm = Math.floor((total % 3600000) / 60000);
      const ss = Math.floor((total % 60000) / 1000);
      const ms3 = Math.floor(total % 1000);
      return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')},${String(ms3).padStart(3, '0')}`;
    };
    
    let out = '';
    for (let i = 0; i < resultDetail.length; i++) {
      const it = resultDetail[i];
      const start = fmt(it.StartMs);
      const end = fmt(it.EndMs);
      const text = String(it.FinalSentence || '').replace(/[，。,.]/g, '');
      out += `${i + 1}\n${start} --> ${end}\n${text}\n\n`;
    }
    
    res.json({ srt: out });
  } catch (e) {
    res.status(500).json({ error: 'audio to text failed' });
  }
});

// ==========================================
// 音频监控与ASR配置 API
// ==========================================

/**
 * API: 启动音频监控进程
 * 路径: /api/audio-watch/start
 * 方法: POST
 * 参数: pythonPath, watchPath, audioFormats
 */
app.post('/api/audio-watch/start', async (req, res) => {
  try {
    // 检查是否已在运行
    if (audioWatchProc && !audioWatchProc.killed) {
      return res.json({ running: true, pid: audioWatchProc.pid });
    }
    
    const { pythonPath = 'python', watchPath, audioFormats } = req.body || {};
    const script = path.join(process.cwd(), 'audio_text.py');
    
    // 检查脚本是否存在
    try {
      await fs.access(script);
    } catch {
      return res.status(400).json({ error: 'audio_text.py not found' });
    }
    
    // 如果提供了配置，更新配置文件
    if (watchPath || audioFormats) {
      try {
        const p = path.join(process.cwd(), 'config.ini');
        let text = '';
        try { text = await fs.readFile(p, 'utf-8'); } catch {}
        const ini = parseIni(text);
        
        // 更新Watch节
        ini.Watch = ini.Watch || {};
        if (watchPath) ini.Watch.WatchPath = watchPath;
        if (audioFormats) ini.Watch.AudioFormats = audioFormats;
        
        // 重建INI内容
        const lines = [];
        lines.push('[TencentCloud]');
        const auth = ini.TencentCloud || ini.auth || {};
        lines.push(`SecretId=${auth.SecretId || ''}`);
        lines.push(`SecretKey=${auth.SecretKey || ''}`);
        lines.push(`Region=${auth.Region || (ini.asr && ini.asr.Region) || ''}`);
        lines.push(`Bucket=${auth.Bucket || ''}`);
        lines.push('');
        lines.push('[asr]');
        const asr = ini.asr || {};
        lines.push(`EngineModelType=${asr.EngineModelType || '16k_zh'}`);
        lines.push('');
        lines.push('[Watch]');
        const watch = ini.Watch || {};
        lines.push(`WatchPath=${watch.WatchPath || './watch'}`);
        lines.push(`AudioFormats=${watch.AudioFormats || '*.wav'}`);
        
        await fs.writeFile(p, lines.join('\n'), 'utf-8');
      } catch {}
    }
    
    // 启动Python子进程
    audioWatchLog = [];
    audioWatchProc = spawn(pythonPath, [script], { cwd: process.cwd(), env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    
    // 监听标准输出
    audioWatchProc.stdout.on('data', (d) => {
      const s = d.toString();
      audioWatchLog.push(...s.split(/\r?\n/).filter(Boolean));
      if (audioWatchLog.length > 200) audioWatchLog = audioWatchLog.slice(-200); // 保留最近200条日志
    });
    
    // 监听标准错误
    audioWatchProc.stderr.on('data', (d) => {
      const s = d.toString();
      audioWatchLog.push(...s.split(/\r?\n/).filter(Boolean));
      if (audioWatchLog.length > 200) audioWatchLog = audioWatchLog.slice(-200);
    });
    
    // 监听退出事件
    audioWatchProc.on('exit', () => {
      audioWatchProc = null;
    });
    
    res.json({ running: true, pid: audioWatchProc.pid });
  } catch {
    res.status(500).json({ error: 'start watch failed' });
  }
});

/**
 * API: 停止音频监控进程
 * 路径: /api/audio-watch/stop
 * 方法: POST
 */
app.post('/api/audio-watch/stop', async (req, res) => {
  try {
    if (audioWatchProc && !audioWatchProc.killed) {
      try { audioWatchProc.kill(); } catch {}
      audioWatchProc = null;
    }
    res.json({ running: false });
  } catch {
    res.status(500).json({ error: 'stop watch failed' });
  }
});

/**
 * API: 获取音频监控状态和日志
 * 路径: /api/audio-watch/status
 * 方法: GET
 */
app.get('/api/audio-watch/status', async (req, res) => {
  res.json({ 
    running: !!(audioWatchProc && !audioWatchProc.killed), 
    pid: audioWatchProc ? audioWatchProc.pid : undefined, 
    logs: audioWatchLog.slice(-50) // 返回最近50条日志
  });
});

/**
 * API: 清除监控日志
 * 路径: /api/audio-watch/clear-logs
 * 方法: POST
 */
app.post('/api/audio-watch/clear-logs', async (req, res) => {
  audioWatchLog = [];
  res.json({ ok: true });
});

/**
 * API: 获取ASR配置
 * 路径: /api/asr-config
 * 方法: GET
 */
app.get('/api/asr-config', async (req, res) => {
  try {
    const cfg = await getASRConfig();
    let ini = {};
    try {
      const p = path.join(process.cwd(), 'config.ini');
      const s = await fs.readFile(p, 'utf-8');
      ini = parseIni(s);
    } catch {}
    const watch = ini.watch || ini.Watch || {};
    res.json({
      secretId: cfg.SecretId,
      secretKey: cfg.SecretKey,
      region: cfg.Region,
      bucket: cfg.Bucket,
      engineModelType: cfg.EngineModelType,
      watchPath: watch.WatchPath || '',
      audioFormats: watch.AudioFormats || watch.AudioPattern || ''
    });
  } catch {
    res.status(500).json({ error: 'read config failed' });
  }
});

/**
 * API: 更新ASR配置
 * 路径: /api/asr-config
 * 方法: POST
 */
app.post('/api/asr-config', async (req, res) => {
  try {
    const { secretId = '', secretKey = '', region = '', bucket = '', engineModelType = '16k_zh', watchPath = './watch', audioFormats = '*.wav' } = req.body || {};
    
    // 构造INI文件内容
    const lines = [];
    lines.push('[TencentCloud]');
    lines.push(`SecretId=${secretId}`);
    lines.push(`SecretKey=${secretKey}`);
    lines.push(`Region=${region}`);
    lines.push(`Bucket=${bucket}`);
    lines.push('');
    lines.push('[asr]');
    lines.push(`EngineModelType=${engineModelType}`);
    lines.push('');
    lines.push('[Watch]');
    lines.push(`WatchPath=${watchPath}`);
    lines.push(`AudioFormats=${audioFormats}`);
    
    const content = lines.join('\n');
    const p = path.join(process.cwd(), 'config.ini');
    await fs.writeFile(p, content, 'utf-8');
    
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'write config failed' });
  }
});

// ==========================================
// 历史记录与UP主合集 API
// ==========================================

/**
 * API: 获取历史记录
 * 路径: /api/history
 * 方法: GET
 */
app.get('/api/history', async (req, res) => {
  const arr = await readHistory();
  // 按时间倒序排列
  arr.sort((a, b) => (b.time || 0) - (a.time || 0));
  res.json(arr);
});

/**
 * API: 添加历史记录
 * 路径: /api/history
 * 方法: POST
 * 参数: upName, upFace, url
 */
app.post('/api/history', async (req, res) => {
  const { upName = '', upFace = '', url } = req.body || {};
  if (!url || typeof url !== 'string') return res.status(400).json({ error: 'missing url' });
  
  const arr = await readHistory();
  const now = Date.now();
  
  // 使用Map去重，保留最新的记录
  const map = new Map(arr.map(i => [i.url, i]));
  map.set(url, { time: now, upName, upFace, url });
  
  // 排序并限制数量为100条
  const out = Array.from(map.values()).sort((a, b) => (b.time || 0) - (a.time || 0)).slice(0, 100);
  
  await writeHistory(out);
  res.json({ ok: true });
});

/**
 * API: 删除历史记录
 * 路径: /api/history
 * 方法: DELETE
 * 参数: url (查询参数，如果不传则清空所有)
 */
app.delete('/api/history', async (req, res) => {
  const url = req.query.url;
  let arr = await readHistory();
  
  if (url && typeof url === 'string') {
    // 删除指定记录
    arr = arr.filter(i => i.url !== url);
  } else {
    // 清空所有记录
    arr = [];
  }
  
  await writeHistory(arr);
  res.json({ ok: true });
});

/**
 * API: 解析UP主合集链接并获取视频列表
 * 路径: /api/up-series
 * 方法: POST
 * 参数: url, page, pageSize, excludeBvids
 */
app.post('/api/up-series', async (req, res) => {
  try {
    const { url, page, pageSize, excludeBvids } = req.body || {};
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: '缺少合集链接' });
    }
    
    // 解析合集URL中的mid和sid
    const match = url.match(/https?:\/\/space\.bilibili\.com\/(\d+)\/lists\/(\d+).*type=series/i);
    if (!match) {
      return res.status(400).json({ error: '合集链接格式不正确' });
    }
    const mid = match[1];
    const sid = match[2];
    const pn = (typeof page === 'number' && page > 0) ? page : 1;
    const ps = (typeof pageSize === 'number' && pageSize > 0 && pageSize <= 50) ? pageSize : 10;

    // 检查缓存
    const cacheKey = `series-${mid}-${sid}-pn${pn}-ps${ps}`;
    const now = Date.now();
    if (upSeriesCache[cacheKey] && now - upSeriesCache[cacheKey].ts < 5 * 60 * 1000) {
      const cached = upSeriesCache[cacheKey].data;
      if (cached && cached.upName) {
        return res.json(cached);
      }
      // 否则继续刷新，补全缺失信息
    }

    let archives = [];
    let totalCount = 0;
    let hasMore = false;
    const exclude = Array.isArray(excludeBvids) ? new Set(excludeBvids.map(String)) : new Set();
    
    // 尝试调用B站API获取合集视频
    try {
      const collect = [];
      const psPage = ps;
      const apiUrl = `https://api.bilibili.com/x/series/archives?mid=${mid}&series_id=${sid}&only_normal=true&sort=desc&pn=${pn}&ps=${psPage}`;
      const resp = await axios.get(apiUrl, { headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': `https://space.bilibili.com/${mid}/lists/${sid}?type=series` } });
      
      if (resp.data && resp.data.code === 0 && resp.data.data) {
        const received = resp.data.data.archives || [];
        const p = resp.data.data.page;
        if (p) totalCount = Number(p.count || p.total || totalCount);
        
        if (Array.isArray(received) && received.length > 0) {
          for (const a of received) {
            const id = String(a.bvid);
            // 过滤已排除的视频
            if (!exclude.has(id) && !collect.some(x => x.bvid === id)) {
              collect.push(a);
            }
          }
        }
      }
      archives = collect.slice(0, ps);
    } catch {}

    // 如果API调用失败或数据不足，尝试爬取HTML页面（备用方案）
    if (!archives || archives.length < ps) {
      try {
        const pageUrl = `https://space.bilibili.com/${mid}/lists/${sid}?type=series`;
        const htmlResp = await axios.get(pageUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const html = htmlResp.data || '';
        const items = [];
        // 正则匹配视频链接
        const regex = /<a\s+href="\/video\/([A-Za-z0-9]+)"[\s\S]*?title="([^"]+)"[\s\S]*?data-src="(https?:\/\/[^"]+)"/g;
        let m;
        while ((m = regex.exec(html))) {
          items.push({ bvid: m[1], title: m[2], pic: m[3] });
        }
        totalCount = items.length;
        const filtered = items.filter(it => !exclude.has(String(it.bvid)));
        const offset = exclude.size; // 已经加载的数量
        const slice = filtered.slice(offset, offset + ps);
        archives = slice.map(it => ({ bvid: it.bvid, title: it.title, pic: it.pic, stat: { view: 0 }, pubdate: Math.floor(Date.now()/1000), duration: 0 }));
      } catch {}
    }

    // 获取UP主信息
    let upName = '';
    let upFace = '';
    const normalize = (u) => {
      if (!u) return '';
      let s = String(u).trim();
      if (s.startsWith('//')) return 'https:' + s;
      if (s.startsWith('http://')) return s.replace('http://', 'https://');
      return s;
    };

    try {
      const info = await getUPInfo(mid);
      if (info && info.data && info.data.name) upName = info.data.name;
      if (info && info.data && info.data.face) upFace = normalize(info.data.face);
    } catch {}
    
    // 如果API获取UP主信息失败，尝试从主页HTML获取
    if (!upName || !upFace) {
      try {
        const homeResp = await axios.get(`https://space.bilibili.com/${mid}`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const html = homeResp.data || '';
        const nm = html.match(/"name":"([^"]+)"/);
        const fc = html.match(/"face":"(https?:\/\/[^\"]+)"/);
        if (!upName && nm) upName = nm[1];
        if (!upFace && fc) upFace = normalize(fc[1]);
      } catch {}
    }

    // 格式化视频列表
    const list = (archives || []).slice(0, ps).map(a => ({
      bvid: a.bvid,
      title: a.title || '',
      cover: normalize(a.pic || ''),
      viewCount: (a.stat && a.stat.view) ? a.stat.view : 0,
      date: a.pubdate ? new Date(a.pubdate * 1000).toISOString().split('T')[0] : '',
      duration: a.duration || 0,
      url: a.bvid ? `https://www.bilibili.com/video/${a.bvid}` : ''
    }));

    // 如果仍未获取到UP主信息，尝试从第一个视频信息中获取
    if ((!upName || !upFace) && list.length > 0 && list[0].bvid) {
      try {
        const vinfo = await getVideoInfo(list[0].bvid);
        if (vinfo && vinfo.data && vinfo.data.owner) {
          if (!upName && vinfo.data.owner.name) upName = vinfo.data.owner.name;
          if (!upFace && vinfo.data.owner.face) upFace = normalize(vinfo.data.owner.face);
        }
      } catch {}
    }

    // 判断是否还有更多数据
    if (totalCount > 0) {
      hasMore = totalCount > (exclude.size + archives.length);
    } else if (Array.isArray(archives)) {
      hasMore = archives.length === ps;
      // 尝试探测下一页
      if (!hasMore) {
        try {
          const probeUrl = `https://api.bilibili.com/x/series/archives?mid=${mid}&series_id=${sid}&only_normal=true&sort=desc&pn=${pn + 1}&ps=1`;
          const probeResp = await axios.get(probeUrl, { headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': `https://space.bilibili.com/${mid}/lists/${sid}?type=series` } });
          const nextArr = probeResp.data && probeResp.data.data && probeResp.data.data.archives ? probeResp.data.data.archives : [];
          hasMore = Array.isArray(nextArr) && nextArr.length > 0;
        } catch {}
      }
    }
    
    const data = { mid, sid, upName, upFace, list, page: pn, pageSize: ps, hasMore, fetchedAt: new Date().toISOString() };
    
    // 写入缓存
    upSeriesCache[cacheKey] = { data, ts: now };
    
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: '获取合集失败' });
  }
});
// ==========================================
// 核心分析 API 与 系统维护
// ==========================================

/**
 * API: 视频/直播回放弹幕分析（核心功能）
 * 路径: /api/analyze
 * 方法: POST
 * 参数: url (B站视频或直播回放链接)
 * 流程: 解析URL -> 获取视频信息 -> 获取弹幕 -> 分析数据 -> 返回结果
 */
app.post('/api/analyze', async (req, res) => {
  const { url } = req.body;
  
  if (!url) {
    return res.status(400).json({ error: '缺少直播回放URL' });
  }
  
  try {
    console.log('收到分析请求，URL:', url);
    
    // 1. 解析URL，提取关键信息（BV号、房间号等）
    const parsedUrl = await parseLiveReplayUrl(url);
    console.log('URL解析结果:', JSON.stringify(parsedUrl, null, 2));
    
    if (!parsedUrl) {
      return res.status(400).json({ error: 'URL解析失败，请检查链接格式' });
    }
    
    // 处理解析错误
    if (parsedUrl.error) {
      console.log('解析错误:', parsedUrl.error);
      return res.status(400).json({ error: parsedUrl.error });
    }
    
    if (!parsedUrl.bvid) {
      console.log('未找到BV号');
      return res.status(400).json({ error: '无法从URL中提取视频信息，请确认是B站视频链接' });
    }
    
    console.log('解析成功，BV号:', parsedUrl.bvid, '标题:', parsedUrl.videoTitle);
    
    const cacheKey = `video-${parsedUrl.bvid}`;
    
    // 2. 获取视频封面并规范化URL
    const vinfoForCover = await getVideoInfo(parsedUrl.bvid);
    const cover = normalizeCoverUrl(vinfoForCover && vinfoForCover.data && vinfoForCover.data.pic);
    
    // 注意：此处注释掉了缓存检查，强制每次都重新获取最新数据
    // if (danmakuData[cacheKey]) { ... }
    
    // 3. 获取视频弹幕数据（通过CID）
    const xmlData = await fetchVideoDanmakuByCID(parsedUrl.bvid);
    if (!xmlData) {
      return res.status(404).json({ error: '无法获取弹幕数据，该视频可能没有弹幕记录' });
    }
    
    // 4. 解析XML数据
    const danmakus = await parseVideoDanmakuXML(xmlData);
    
    if (danmakus.length === 0) {
      return res.status(404).json({ error: '该视频没有弹幕数据' });
    }
    
    // 5. 执行数据分析
    console.log('分析数据，弹幕数量:', danmakus.length);
    const stats = analyzeDanmakuData(danmakus);
    console.log('分析结果，统计段数量:', stats.length);
    
    if (stats.length > 0) {
      console.log('第一个统计段:', stats[0]);
      console.log('最后一个统计段:', stats[stats.length - 1]);
    }
    
    // 提取热词
    const keywords = await extractKeywords(danmakus);
    
    // 6. 构造返回结果
    const result = {
      bvid: parsedUrl.bvid,
      title: parsedUrl.videoTitle,
      cover: cover,
      date: parsedUrl.date,
      url: parsedUrl.realUrl,
      videoOwner: parsedUrl.videoOwner,
      totalDanmakus: danmakus.length,
      danmakus,
      stats,
      keywords,
      generatedAt: new Date().toISOString()
    };
    
    // 存入缓存
    danmakuData[cacheKey] = result;
    
    console.log('分析完成，弹幕总数:', danmakus.length);
    res.json(result);
  } catch (error) {
    console.error('处理视频弹幕数据失败:', error);
    res.status(500).json({ error: '服务器内部错误，请稍后重试' });
  }
});

// 定时任务：每天凌晨清理过期缓存（保留7天内的数据）
cron.schedule('0 0 * * *', () => {
  console.log('清理过期缓存...');
  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
  
  Object.keys(danmakuData).forEach(key => {
    const data = danmakuData[key];
    if (new Date(data.generatedAt) < oneWeekAgo) {
      delete danmakuData[key];
    }
  });
});

/**
 * API: 手动清除所有缓存
 * 路径: /api/cache
 * 方法: DELETE
 */
app.delete('/api/cache', (req, res) => {
  console.log('清除缓存，当前缓存数量:', Object.keys(danmakuData).length);
  const cacheSize = Object.keys(danmakuData).length;
  danmakuData = {};
  res.json({ message: '缓存已清除', clearedCount: cacheSize });
});

/**
 * API: 测试接口 - 检查弹幕时间间隔
 * 用于调试弹幕数据的密度和分布情况
 * 路径: /api/test-interval/:roomId/:date
 * 方法: GET
 */
app.get('/api/test-interval/:roomId/:date', async (req, res) => {
  const { roomId, date } = req.params;
  
  try {
    const xmlData = await fetchDanmakuXML(roomId, date);
    if (!xmlData) {
      return res.status(404).json({ error: '无法获取弹幕数据' });
    }
    
    const danmakus = await parseDanmakuXML(xmlData);
    console.log('原始弹幕数量:', danmakus.length);
    
    if (danmakus.length === 0) {
      return res.json({ message: '没有弹幕数据' });
    }
    
    // 检查原始时间戳
    const timestamps = danmakus.map(d => d.time).sort((a, b) => a - b);
    const intervals = [];
    for (let i = 1; i < Math.min(20, timestamps.length); i++) {
      intervals.push(timestamps[i] - timestamps[i-1]);
    }
    
    console.log('前20个时间间隔:', intervals);
    console.log('最小间隔:', Math.min(...intervals));
    console.log('最大间隔:', Math.max(...intervals));
    
    // 分析统计结果
    const stats = analyzeDanmakuData(danmakus);
    console.log('统计段数量:', stats.length);
    if (stats.length > 0) {
      console.log('第一个统计段:', stats[0]);
      console.log('统计段时间间隔:', stats[0].endTime - stats[0].startTime);
    }
    
    res.json({
      totalDanmakus: danmakus.length,
      firstFewTimestamps: timestamps.slice(0, 10),
      intervals: intervals.slice(0, 10),
      minInterval: Math.min(...intervals),
      maxInterval: Math.max(...intervals),
      statsCount: stats.length,
      firstStat: stats[0],
      statInterval: stats.length > 0 ? stats[0].endTime - stats[0].startTime : 0
    });
    
  } catch (error) {
    console.error('测试失败:', error);
    res.status(500).json({ error: '测试失败' });
  }
});

// 启动服务器
app.listen(PORT, () => {
  console.log(`B站直播回放弹幕分析服务器运行在端口 ${PORT}`);
  console.log(`API 地址: http://localhost:${PORT}/api`);
});

export default app;
