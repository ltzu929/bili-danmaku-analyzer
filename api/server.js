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

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());
const upload = multer();

// 存储弹幕数据的简单数据库
let danmakuData = {};
let upSeriesCache = {};
const historyDir = path.join(process.cwd(), 'data');
const historyFile = path.join(historyDir, 'up_history.json');

let audioWatchProc = null;
let audioWatchLog = [];

async function readHistory() {
  try {
    await fs.mkdir(historyDir, { recursive: true });
    const buf = await fs.readFile(historyFile, 'utf-8');
    const arr = JSON.parse(buf);
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    return [];
  }
}

async function writeHistory(arr) {
  await fs.mkdir(historyDir, { recursive: true });
  await fs.writeFile(historyFile, JSON.stringify(arr, null, 2), 'utf-8');
}

// 统一封面URL的工具函数（协议补齐与HTTP→HTTPS转换）
function normalizeCoverUrl(u) {
  if (!u) return '';
  let s = String(u).trim();
  if (s.startsWith('//')) return 'https:' + s;
  if (s.startsWith('http://')) return s.replace('http://', 'https://');
  return s;
}

function parseIni(text) {
  const out = {};
  let section = '';
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    const mSec = line.match(/^\[(.+?)\]$/);
    if (mSec) { section = mSec[1].toLowerCase(); if (!out[section]) out[section] = {}; continue; }
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

async function getASRConfig() {
  let ini = {};
  try {
    const p = path.join(process.cwd(), 'config.ini');
    const s = await fs.readFile(p, 'utf-8');
    ini = parseIni(s);
  } catch {}
  const env = process.env;
  const auth = ini.auth || ini.TencentCloud || {};
  const cos = ini.cos || {};
  const asr = ini.asr || {};
  const SecretId = env.TC_SECRET_ID || auth.SecretId || '';
  const SecretKey = env.TC_SECRET_KEY || auth.SecretKey || '';
  const Region = env.TC_REGION || auth.Region || cos.Region || asr.Region || '';
  const Bucket = env.TC_COS_BUCKET || auth.Bucket || cos.Bucket || '';
  const EngineModelType = env.TC_ASR_ENGINE || asr.EngineModelType || '16k_zh';
  return { SecretId, SecretKey, Region, Bucket, EngineModelType };
}

/**
 * 获取B站视频弹幕数据（CID方式）
 * @param {string} bvid - BV号
 */
async function fetchVideoDanmakuByCID(bvid) {
  try {
    // 首先获取视频的CID
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
    
    // 获取弹幕XML数据
    const danmakuUrl = `https://api.bilibili.com/x/v1/dm/list.so?oid=${cid}`;
    const danmakuResponse = await axios.get(danmakuUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      responseType: 'arraybuffer' // 弹幕数据是XML格式，需要二进制接收
    });
    
    // 将二进制数据转换为字符串（XML格式）
 const xmlData = Buffer.from(danmakuResponse.data).toString('utf-8');
    console.log('成功获取弹幕数据，长度:', xmlData.length);
    
    return xmlData;
  } catch (error) {
    console.error('获取视频弹幕数据失败:', error.message);
    return null;
  }
}

/**
 * 解析B站视频弹幕XML数据（CID方式）
 * @param {string} xmlData - XML格式的弹幕数据
 */
async function parseVideoDanmakuXML(xmlData) {
  try {
    const parser = new xml2js.Parser();
    const result = await parser.parseStringPromise(xmlData);
    
    const danmakus = [];
    
    // B站视频弹幕XML格式与直播回放略有不同
    if (result && result.i && result.i.d) {
      result.i.d.forEach(danmaku => {
        const attr = danmaku.$.p.split(',');
        danmakus.push({
          time: parseFloat(attr[0]), // 出现时间（秒）
          type: parseInt(attr[1]),   // 弹幕类型
          size: parseInt(attr[2]),   // 字体大小
          color: parseInt(attr[3]),  // 颜色
          timestamp: parseInt(attr[4]), // 发送时间戳
          pool: parseInt(attr[5]),   // 弹幕池
          uid: attr[6] || '',        // 用户ID（可能为空）
          id: attr[7] || '',         // 弹幕ID（可能为空）
          text: danmaku._ || ''       // 弹幕内容
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
 * 解析B站直播回放URL，提取关键信息
 * @param {string} url - B站直播回放URL
 */
async function parseLiveReplayUrl(url) {
  try {
    let realUrl = url;
    
    // 处理b23.tv短链接
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
    
    // 提取BV号或直播回放ID
    let roomId = null;
    let date = null;
    let bvid = null;
    let videoTitle = '';
    let videoOwner = null;
    let videoCover = '';
    
    // 处理直播回放URL格式: https://live.bilibili.com/record/ROOMID
    const recordMatch = realUrl.match(/live\.bilibili\.com\/record\/(\d+)/);
    if (recordMatch) {
      roomId = recordMatch[1];
      console.log('检测到直播回放格式，房间ID:', roomId);
      
      // 对于直播回放，我们需要额外的API调用来获取日期信息
      const roomInfo = await getRoomInfo(roomId);
      if (roomInfo && roomInfo.data && roomInfo.data.live_time) {
        try {
          const liveTime = new Date(roomInfo.data.live_time * 1000);
          date = liveTime.toISOString().split('T')[0];
          console.log('获取到直播日期:', date);
        } catch (dateError) {
          console.error('日期格式化失败:', dateError);
          date = new Date().toISOString().split('T')[0];
        }
      }
    }
    
    // 如果没有检测到直播间ID，直接处理BV号视频
    
    // 处理视频URL格式: BV号
    const bvMatch = realUrl.match(/BV[a-zA-Z0-9]+/);
    if (bvMatch && !roomId) {
      bvid = bvMatch[0];
      console.log('检测到BV号:', bvid);
      
      // 对于BV号，我们需要先获取视频信息
      const videoInfo = await getVideoInfo(bvid);
      if (videoInfo && videoInfo.data) {
        console.log('视频信息获取成功');
        
        // 获取视频基本信息
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
    
    if (!roomId && !bvid) {
      console.log('无法提取房间ID或BV号');
      return { error: '无法从URL中提取视频信息，请确认是B站视频链接' };
    }
    
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
 * 获取直播间信息
 * @param {string} roomId - 直播间ID
 */
async function getRoomInfo(roomId) {
  try {
    const response = await axios.get(`https://api.live.bilibili.com/room/v1/Room/get_info?room_id=${roomId}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    return response.data;
  } catch (error) {
    console.error('获取直播间信息失败:', error.message);
    return null;
  }
}

/**
 * 获取视频信息
 * @param {string} bvid - BV号
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

// 获取视频封面（供前端兜底调用）
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
 * 获取UP主信息
 * @param {string} mid - UP主ID
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
 * 获取B站直播回放弹幕XML数据（新版接口，支持1分钟间隔）
 * @param {string} roomId - 直播间ID
 * @param {string} date - 直播日期 (格式: YYYY-MM-DD)
 */
async function fetchDanmakuXML(roomId, date) {
  try {
    // 使用新的API端点获取更详细的弹幕数据
    const xmlUrl = `https://api.live.bilibili.com/xlive/web-room/v1/dM/gethistory?roomid=${roomId}&date=${date}`;
    
    const response = await axios.get(xmlUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    // 检查是否是聚合数据
    if (response.data && response.data.code === 0 && response.data.data) {
      const data = response.data.data;
      
      // 如果返回的是房间弹幕列表（非聚合）
      if (data.room && data.room[0] && data.room[0].danmaku) {
        console.log('获取到房间弹幕列表，数量:', data.room[0].danmaku.length);
        return response.data;
      }
      
      // 如果返回的是聚合数据，尝试获取详细数据
      console.log('获取到聚合数据，尝试获取详细弹幕...');
      
      // 尝试获取更详细的弹幕数据
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
 */
async function parseDanmakuXML(xmlData) {
  try {
    console.log('原始XML数据长度:', xmlData.length);
    console.log('XML数据前500字符:', xmlData.substring(0, 500));
    
    const parser = new xml2js.Parser();
    const result = await parser.parseStringPromise(xmlData);
    
    const danmakus = [];
    
    if (result && result.i && result.i.d) {
      console.log('找到弹幕数量:', result.i.d.length);
      
      result.i.d.forEach((danmaku, index) => {
        const attr = danmaku.$.p.split(',');
        const time = parseFloat(attr[0]);
        
        // 调试：检查时间戳
        if (index < 5) {
          console.log(`弹幕${index}: time=${time}, attr=${attr[0]}`);
        }
        
        danmakus.push({
          time: time, // 时间戳
          type: parseInt(attr[1]),   // 弹幕类型
          size: parseInt(attr[2]),   // 字体大小
          color: parseInt(attr[3]),  // 颜色
          timestamp: parseInt(attr[4]), // 发送时间
          pool: parseInt(attr[5]),   // 弹幕池
          uid: attr[6],             // 用户ID
          id: attr[7],              // 弹幕ID
          text: danmaku._ || ''      // 弹幕内容
        });
      });
    }
    
    // 检查时间戳分布
    if (danmakus.length > 0) {
      const timestamps = danmakus.map(d => d.time).sort((a, b) => a - b);
      const uniqueTimestamps = [...new Set(timestamps)];
      console.log('唯一时间戳数量:', uniqueTimestamps.length);
      console.log('前10个时间戳:', uniqueTimestamps.slice(0, 10));
      
      // 检查时间间隔
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

/**
 * 分析直播回放弹幕数据，生成统计信息
 * @param {Array} danmakus - 直播回放弹幕数组
 * @param {number} interval - 时间间隔（秒）
 */
function analyzeDanmakuData(danmakus, interval = 60) { // 默认1分钟间隔
  const stats = {};
  
  // 按时间间隔分组统计
  danmakus.forEach(danmaku => {
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
    
    // 分类统计
    if (/[\u4e00-\u9fa5]/.test(danmaku.text)) {
      stats[key].chineseCount++;
    }
    if (/[a-zA-Z]/.test(danmaku.text)) {
      stats[key].englishCount++;
    }
    if (/[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/u.test(danmaku.text)) {
      stats[key].withEmoji++;
    }
  });
  
  // 识别高峰时段
  const counts = Object.values(stats).map(s => s.count);
  const avgCount = counts.reduce((a, b) => a + b, 0) / counts.length;
  const threshold = avgCount * 1.5; // 超过平均值1.5倍视为高峰
  
  Object.values(stats).forEach(stat => {
    stat.peak = stat.count > threshold;
  });
  
  return Object.values(stats).sort((a, b) => a.startTime - b.startTime);
}

/**
 * 提取热词
 * @param {Array} danmakus - 弹幕数组
 */
async function extractKeywords(danmakus) {
  try {
    // 简单的关键词提取算法
    const wordCount = {};
    const stopWords = new Set(['的', '了', '在', '是', '我', '你', '他', '她', '它', '们', '这', '那', '有', '就', '不', '人', '都', '一', '一个', '上', '也', '很', '到', '说', '要', '去', '和', '与', '或', '但', '而', '因为', '所以', '如果', '虽然', '然而']);
    
    danmakus.forEach(d => {
      // 简单的中文分词（按字符分割，过滤掉标点符号和停用词）
      const words = d.text.split('').filter(char => 
        /[\u4e00-\u9fa5]/.test(char) && !stopWords.has(char) && char.length > 0
      );
      
      words.forEach(word => {
        wordCount[word] = (wordCount[word] || 0) + 1;
      });
    });
    
    // 转换为关键词列表并排序
    const keywords = Object.entries(wordCount)
      .map(([word, count]) => ({
        word,
        weight: count / danmakus.length, // 简单的权重计算
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

// API路由

// 获取直播回放弹幕数据
app.get('/api/danmaku/:roomId/:date', async (req, res) => {
  const { roomId, date } = req.params;
  
  try {
    const cacheKey = `${roomId}-${date}`;
    
    // 检查缓存
    if (danmakuData[cacheKey]) {
      return res.json(danmakuData[cacheKey]);
    }
    
    // 获取XML数据
    const xmlData = await fetchDanmakuXML(roomId, date);
    if (!xmlData) {
      return res.status(404).json({ error: '无法获取弹幕数据' });
    }
    
    // 解析XML
    const danmakus = await parseDanmakuXML(xmlData);
    
    // 分析数据
    console.log('分析数据，弹幕数量:', danmakus.length);
    
    // 调试：检查弹幕时间戳分布
    if (danmakus.length > 0) {
      const timestamps = danmakus.map(d => d.time).sort((a, b) => a - b);
      console.log('弹幕时间范围:', timestamps[0], '到', timestamps[timestamps.length - 1]);
      console.log('前10个时间戳:', timestamps.slice(0, 10));
      console.log('后10个时间戳:', timestamps.slice(-10));
    }
    
    const stats = analyzeDanmakuData(danmakus);
    console.log('分析结果，统计段数量:', stats.length);
    if (stats.length > 0) {
      console.log('第一个统计段:', stats[0]);
      console.log('最后一个统计段:', stats[stats.length - 1]);
      
      // 检查统计段的时间间隔
      console.log('统计段时间间隔检查:');
      for (let i = 0; i < Math.min(5, stats.length); i++) {
        const stat = stats[i];
        console.log(`段${i}: ${stat.startTime}-${stat.endTime} (${stat.endTime - stat.startTime}秒), 弹幕数: ${stat.count}`);
      }
    }
    const keywords = await extractKeywords(danmakus);
    
    const result = {
      roomId,
      date,
      totalDanmakus: danmakus.length,
      danmakus,
      stats,
      keywords,
      generatedAt: new Date().toISOString()
    };
    
    // 缓存结果
    danmakuData[cacheKey] = result;
    
    res.json(result);
  } catch (error) {
    console.error('处理直播回放弹幕数据失败:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

// 搜索直播回放弹幕
app.get('/api/danmaku/search/:roomId/:date', async (req, res) => {
  const { roomId, date } = req.params;
  const { keyword } = req.query;
  
  if (!keyword) {
    return res.status(400).json({ error: '缺少搜索关键词' });
  }
  
  try {
    const cacheKey = `${roomId}-${date}`;
    let danmakus = [];
    
    // 获取缓存的弹幕数据
    if (danmakuData[cacheKey]) {
      danmakus = danmakuData[cacheKey].danmakus;
    } else {
      // 如果没有缓存，重新获取
      const xmlData = await fetchDanmakuXML(roomId, date);
      if (xmlData) {
        danmakus = await parseDanmakuXML(xmlData);
      }
    }
    
    // 搜索匹配的弹幕
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

// 获取直播间信息
app.get('/api/room/:roomId', async (req, res) => {
  const { roomId } = req.params;
  
  try {
    const response = await axios.get(`https://api.live.bilibili.com/room/v1/Room/get_info?room_id=${roomId}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    res.json(response.data);
  } catch (error) {
    console.error('获取直播间信息失败:', error);
    res.status(500).json({ error: '无法获取直播间信息' });
  }
});

app.get('/api/cover', async (req, res) => {
  try {
    const url = req.query.url;
    if (!url || typeof url !== 'string') {
      return res.status(400).send('missing url');
    }
    const response = await axios.get(url, { responseType: 'arraybuffer', headers: { 'User-Agent': 'Mozilla/5.0' } });
    const ext = (url.split('.').pop() || '').toLowerCase();
    const type = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
    res.setHeader('Content-Type', type);
    res.send(response.data);
  } catch (e) {
    res.status(502).send('fetch cover failed');
  }
});

app.get('/api/system/downloads-path', async (req, res) => {
  try {
    const home = os.homedir();
    const downloads = path.join(home, 'Downloads');
    res.json({ path: downloads });
  } catch (e) {
    res.status(500).json({ error: 'failed to get downloads path' });
  }
});

app.post('/api/save-cover', async (req, res) => {
  try {
    const { url, bvid, dir } = req.body || {};
    if (!url || typeof url !== 'string') return res.status(400).json({ error: 'missing url' });
    const targetDir = (typeof dir === 'string' && dir.trim()) ? dir.trim() : path.join(os.homedir(), 'Downloads');
    await fs.mkdir(targetDir, { recursive: true });
    const response = await axios.get(url, { responseType: 'arraybuffer', headers: { 'User-Agent': 'Mozilla/5.0' } });
    const ct = (response.headers && (response.headers['content-type'] || response.headers['Content-Type'])) || '';
    let ext = 'jpg';
    if (ct.includes('png')) ext = 'png'; else if (ct.includes('webp')) ext = 'webp'; else if (ct.includes('jpeg')) ext = 'jpg';
    else {
      const ex = (url.split('.').pop() || '').toLowerCase();
      if (['png', 'jpg', 'jpeg', 'webp'].includes(ex)) ext = ex;
    }
    const filename = `cover_${String(bvid || Date.now())}.${ext}`;
    const filePath = path.join(targetDir, filename);
    await fs.writeFile(filePath, response.data);
    res.json({ ok: true, path: filePath });
  } catch (e) {
    res.status(500).json({ error: 'save cover failed' });
  }
});

app.post('/api/audio-to-text', upload.single('audio'), async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'missing audio' });
    const cfg = await getASRConfig();
    if (!cfg.SecretId || !cfg.SecretKey || !cfg.Region || !cfg.Bucket) return res.status(400).json({ error: 'missing credentials' });
    const cos = new COS({ SecretId: cfg.SecretId, SecretKey: cfg.SecretKey });
    const key = `asr/${Date.now()}_${String(file.originalname || 'audio').replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    await new Promise((resolve, reject) => {
      cos.putObject({ Bucket: cfg.Bucket, Region: cfg.Region, Key: key, StorageClass: 'STANDARD', Body: file.buffer }, (err, data) => {
        if (err) reject(err); else resolve(data);
      });
    });
    const signed = cos.getObjectUrl({ Bucket: cfg.Bucket, Region: cfg.Region, Key: key, Sign: true, Expires: 3600 });
    const AsrClient = tencentcloud.asr.v20190614.Client;
    const client = new AsrClient({ credential: { secretId: cfg.SecretId, secretKey: cfg.SecretKey }, region: cfg.Region, profile: { httpProfile: { endpoint: 'asr.tencentcloudapi.com' } } });
    const create = await client.CreateRecTask({ EngineModelType: cfg.EngineModelType, ChannelNum: 1, ResTextFormat: 3, SourceType: 0, Url: signed });
    const taskId = create.Data.TaskId;
    let resultDetail = null;
    const started = Date.now();
    while (Date.now() - started < 10 * 60 * 1000) {
      const st = await client.DescribeTaskStatus({ TaskId: taskId });
      const s = st.Data.StatusStr || st.Data.Status || '';
      if (String(s).toLowerCase() === 'success') { resultDetail = st.Data.ResultDetail || []; break; }
      if (String(s).toLowerCase() === 'failed') { break; }
      await new Promise(r => setTimeout(r, 5000));
    }
    try { cos.deleteObject({ Bucket: cfg.Bucket, Region: cfg.Region, Key: key }, () => {}); } catch {}
    if (!resultDetail || !Array.isArray(resultDetail) || resultDetail.length === 0) return res.status(500).json({ error: 'recognition failed' });
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

app.post('/api/audio-watch/start', async (req, res) => {
  try {
    if (audioWatchProc && !audioWatchProc.killed) {
      return res.json({ running: true, pid: audioWatchProc.pid });
    }
    const { pythonPath = 'python', watchPath, audioFormats } = req.body || {};
    const script = path.join(process.cwd(), 'audio_text.py');
    try {
      await fs.access(script);
    } catch {
      return res.status(400).json({ error: 'audio_text.py not found' });
    }
    if (watchPath || audioFormats) {
      try {
        const p = path.join(process.cwd(), 'config.ini');
        let text = '';
        try { text = await fs.readFile(p, 'utf-8'); } catch {}
        const ini = parseIni(text);
        ini.Watch = ini.Watch || {};
        if (watchPath) ini.Watch.WatchPath = watchPath;
        if (audioFormats) ini.Watch.AudioFormats = audioFormats;
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
    audioWatchLog = [];
    audioWatchProc = spawn(pythonPath, [script], { cwd: process.cwd(), env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    audioWatchProc.stdout.on('data', (d) => {
      const s = d.toString();
      audioWatchLog.push(...s.split(/\r?\n/).filter(Boolean));
      if (audioWatchLog.length > 200) audioWatchLog = audioWatchLog.slice(-200);
    });
    audioWatchProc.stderr.on('data', (d) => {
      const s = d.toString();
      audioWatchLog.push(...s.split(/\r?\n/).filter(Boolean));
      if (audioWatchLog.length > 200) audioWatchLog = audioWatchLog.slice(-200);
    });
    audioWatchProc.on('exit', () => {
      audioWatchProc = null;
    });
    res.json({ running: true, pid: audioWatchProc.pid });
  } catch {
    res.status(500).json({ error: 'start watch failed' });
  }
});

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

app.get('/api/audio-watch/status', async (req, res) => {
  res.json({ running: !!(audioWatchProc && !audioWatchProc.killed), pid: audioWatchProc ? audioWatchProc.pid : undefined, logs: audioWatchLog.slice(-50) });
});

app.post('/api/audio-watch/clear-logs', async (req, res) => {
  audioWatchLog = [];
  res.json({ ok: true });
});

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

app.post('/api/asr-config', async (req, res) => {
  try {
    const { secretId = '', secretKey = '', region = '', bucket = '', engineModelType = '16k_zh', watchPath = './watch', audioFormats = '*.wav' } = req.body || {};
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

app.get('/api/history', async (req, res) => {
  const arr = await readHistory();
  arr.sort((a, b) => (b.time || 0) - (a.time || 0));
  res.json(arr);
});

app.post('/api/history', async (req, res) => {
  const { upName = '', upFace = '', url } = req.body || {};
  if (!url || typeof url !== 'string') return res.status(400).json({ error: 'missing url' });
  const arr = await readHistory();
  const now = Date.now();
  const map = new Map(arr.map(i => [i.url, i]));
  map.set(url, { time: now, upName, upFace, url });
  const out = Array.from(map.values()).sort((a, b) => (b.time || 0) - (a.time || 0)).slice(0, 100);
  await writeHistory(out);
  res.json({ ok: true });
});

app.delete('/api/history', async (req, res) => {
  const url = req.query.url;
  let arr = await readHistory();
  if (url && typeof url === 'string') {
    arr = arr.filter(i => i.url !== url);
  } else {
    arr = [];
  }
  await writeHistory(arr);
  res.json({ ok: true });
});

// 解析UP主合集链接并获取最新5个视频
app.post('/api/up-series', async (req, res) => {
  try {
    const { url, page, pageSize, excludeBvids } = req.body || {};
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: '缺少合集链接' });
    }
    const match = url.match(/https?:\/\/space\.bilibili\.com\/(\d+)\/lists\/(\d+).*type=series/i);
    if (!match) {
      return res.status(400).json({ error: '合集链接格式不正确' });
    }
    const mid = match[1];
    const sid = match[2];
    const pn = (typeof page === 'number' && page > 0) ? page : 1;
    const ps = (typeof pageSize === 'number' && pageSize > 0 && pageSize <= 50) ? pageSize : 10;

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
            if (!exclude.has(id) && !collect.some(x => x.bvid === id)) {
              collect.push(a);
            }
          }
        }
      }
      archives = collect.slice(0, ps);
    } catch {}

    if (!archives || archives.length < ps) {
      try {
        const pageUrl = `https://space.bilibili.com/${mid}/lists/${sid}?type=series`;
        const htmlResp = await axios.get(pageUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const html = htmlResp.data || '';
        const items = [];
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

    let upName = '';
    let upFace = '';
    try {
      const info = await getUPInfo(mid);
      if (info && info.data && info.data.name) upName = info.data.name;
      if (info && info.data && info.data.face) upFace = normalize(info.data.face);
    } catch {}
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

    const normalize = (u) => {
      if (!u) return '';
      let s = String(u).trim();
      if (s.startsWith('//')) return 'https:' + s;
      if (s.startsWith('http://')) return s.replace('http://', 'https://');
      return s;
    };

    const list = (archives || []).slice(0, ps).map(a => ({
      bvid: a.bvid,
      title: a.title || '',
      cover: normalize(a.pic || ''),
      viewCount: (a.stat && a.stat.view) ? a.stat.view : 0,
      date: a.pubdate ? new Date(a.pubdate * 1000).toISOString().split('T')[0] : '',
      duration: a.duration || 0,
      url: a.bvid ? `https://www.bilibili.com/video/${a.bvid}` : ''
    }));

    if ((!upName || !upFace) && list.length > 0 && list[0].bvid) {
      try {
        const vinfo = await getVideoInfo(list[0].bvid);
        if (vinfo && vinfo.data && vinfo.data.owner) {
          if (!upName && vinfo.data.owner.name) upName = vinfo.data.owner.name;
          if (!upFace && vinfo.data.owner.face) upFace = normalize(vinfo.data.owner.face);
        }
      } catch {}
    }

    if (totalCount > 0) {
      hasMore = totalCount > (exclude.size + archives.length);
    } else if (Array.isArray(archives)) {
      hasMore = archives.length === ps;
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
    upSeriesCache[cacheKey] = { data, ts: now };
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: '获取合集失败' });
  }
});
// 新的API路由：基于URL的直播回放弹幕分析（视频弹幕版本）
app.post('/api/analyze', async (req, res) => {
  const { url } = req.body;
  
  if (!url) {
    return res.status(400).json({ error: '缺少直播回放URL' });
  }
  
  try {
    console.log('收到分析请求，URL:', url);
    
    // 解析直播回放URL
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
    
    // 从视频信息获取并归一化封面
    const vinfoForCover = await getVideoInfo(parsedUrl.bvid);
    const cover = normalizeCoverUrl(vinfoForCover && vinfoForCover.data && vinfoForCover.data.pic);
    
    // 检查缓存（强制刷新，不使用缓存）
    // if (danmakuData[cacheKey]) {
    //   console.log('使用缓存数据');
    //   return res.json(danmakuData[cacheKey]);
    // }
    
    // 获取视频弹幕数据（使用CID方式）
    const xmlData = await fetchVideoDanmakuByCID(parsedUrl.bvid);
    if (!xmlData) {
      return res.status(404).json({ error: '无法获取弹幕数据，该视频可能没有弹幕记录' });
    }
    
    // 解析XML
    const danmakus = await parseVideoDanmakuXML(xmlData);
    
    if (danmakus.length === 0) {
      return res.status(404).json({ error: '该视频没有弹幕数据' });
    }
    
    // 分析数据
    console.log('分析数据，弹幕数量:', danmakus.length);
    const stats = analyzeDanmakuData(danmakus);
    console.log('分析结果，统计段数量:', stats.length);
    if (stats.length > 0) {
      console.log('第一个统计段:', stats[0]);
      console.log('最后一个统计段:', stats[stats.length - 1]);
    }
    const keywords = await extractKeywords(danmakus);
    
    const result = {
      bvid: parsedUrl.bvid,
      title: parsedUrl.videoTitle,
      cover: cover,
      date: parsedUrl.date,
      url: parsedUrl.realUrl,
      totalDanmakus: danmakus.length,
      danmakus,
      stats,
      keywords,
      generatedAt: new Date().toISOString()
    };
    
    // 缓存结果
    danmakuData[cacheKey] = result;
    
    console.log('分析完成，弹幕总数:', danmakus.length);
    res.json(result);
  } catch (error) {
    console.error('处理视频弹幕数据失败:', error);
    res.status(500).json({ error: '服务器内部错误，请稍后重试' });
  }
});

// 清理过期缓存（每天凌晨执行）
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

// 清除缓存端点
app.delete('/api/cache', (req, res) => {
  console.log('清除缓存，当前缓存数量:', Object.keys(danmakuData).length);
  const cacheSize = Object.keys(danmakuData).length;
  danmakuData = {};
  res.json({ message: '缓存已清除', clearedCount: cacheSize });
});

// 测试端点：检查时间间隔
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

app.listen(PORT, () => {
  console.log(`B站直播回放弹幕分析服务器运行在端口 ${PORT}`);
  console.log(`API 地址: http://localhost:${PORT}/api`);
});

export default app;
