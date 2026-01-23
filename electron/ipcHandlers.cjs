const { ipcMain, app } = require('electron');
const axios = require('axios');
const xml2js = require('xml2js');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

// ==========================================
// 配置与常量定义
// ==========================================

// 内存缓存
let danmakuData = {};
let upSeriesCache = {};

// 历史记录文件名
const HISTORY_FILENAME = 'up_history.json';

// ==========================================
// 辅助工具函数
// ==========================================

/**
 * 获取用户数据目录
 * 优先使用 Electron 的 userData 路径
 */
function getUserDataDir() {
  return app.getPath('userData');
}

/**
 * 读取历史记录文件
 */
async function readHistory() {
  try {
    const dir = getUserDataDir();
    const historyFile = path.join(dir, HISTORY_FILENAME);
    
    // 确保目录存在
    await fs.mkdir(dir, { recursive: true });
    
    try {
      const buf = await fs.readFile(historyFile, 'utf-8');
      const arr = JSON.parse(buf);
      return Array.isArray(arr) ? arr : [];
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }
  } catch (e) {
    console.error('读取历史记录失败:', e);
    return [];
  }
}

/**
 * 写入历史记录文件
 */
async function writeHistory(arr) {
  const dir = getUserDataDir();
  const historyFile = path.join(dir, HISTORY_FILENAME);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(historyFile, JSON.stringify(arr, null, 2), 'utf-8');
}

/**
 * 统一封面URL格式
 */
function normalizeCoverUrl(u) {
  if (!u) return '';
  let s = String(u).trim();
  if (s.startsWith('//')) return 'https:' + s;
  if (s.startsWith('http://')) return s.replace('http://', 'https://');
  return s;
}

// ==========================================
// B站 API 交互逻辑 (保持原有逻辑不变)
// ==========================================

async function fetchVideoDanmakuByCID(bvid) {
  try {
    const cidResponse = await axios.get(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });
    
    if (!cidResponse.data?.data?.cid) {
      console.error('无法获取视频CID');
      return null;
    }
    
    const cid = cidResponse.data.data.cid;
    const danmakuUrl = `https://api.bilibili.com/x/v1/dm/list.so?oid=${cid}`;
    const danmakuResponse = await axios.get(danmakuUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      responseType: 'arraybuffer'
    });
    
    return Buffer.from(danmakuResponse.data).toString('utf-8');
  } catch (error) {
    console.error('获取视频弹幕数据失败:', error.message);
    return null;
  }
}

async function parseVideoDanmakuXML(xmlData) {
  try {
    const parser = new xml2js.Parser();
    const result = await parser.parseStringPromise(xmlData);
    const danmakus = [];
    
    if (result && result.i && result.i.d) {
      result.i.d.forEach(danmaku => {
        const attr = danmaku.$.p.split(',');
        danmakus.push({
          time: parseFloat(attr[0]),
          type: parseInt(attr[1]),
          size: parseInt(attr[2]),
          color: parseInt(attr[3]),
          timestamp: parseInt(attr[4]),
          pool: parseInt(attr[5]),
          uid: attr[6] || '',
          id: attr[7] || '',
          text: danmaku._ || ''
        });
      });
    }
    return danmakus;
  } catch (error) {
    console.error('解析视频弹幕XML失败:', error.message);
    return [];
  }
}

async function getVideoInfo(bvid) {
  try {
    const response = await axios.get(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });
    return response.data;
  } catch (error) {
    console.error('获取视频信息失败:', error.message);
    return null;
  }
}

async function getUPInfo(mid) {
  try {
    const response = await axios.get(`https://api.bilibili.com/x/space/acc/info?mid=${mid}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });
    return response.data;
  } catch (error) {
    console.error('获取UP主信息失败:', error.message);
    return null;
  }
}

async function parseLiveReplayUrl(url) {
  try {
    let realUrl = url;
    if (url.includes('b23.tv')) {
      try {
        const response = await axios.head(url, {
          maxRedirects: 5,
          validateStatus: (status) => status >= 200 && status < 400
        });
        realUrl = response.request.res.responseUrl || url;
      } catch (error) {
        return { error: '短链接解析失败: ' + error.message };
      }
    }
    
    let roomId = null;
    let date = null;
    let bvid = null;
    let videoTitle = '';
    let videoOwner = null;
    let videoCover = '';
    
    const recordMatch = realUrl.match(/live\.bilibili\.com\/record\/(\d+)/);
    if (recordMatch) {
      roomId = recordMatch[1];
    }
    
    const bvMatch = realUrl.match(/BV[a-zA-Z0-9]+/);
    if (bvMatch && !roomId) {
      bvid = bvMatch[0];
      const videoInfo = await getVideoInfo(bvid);
      if (videoInfo && videoInfo.data) {
        videoTitle = videoInfo.data.title || '';
        videoOwner = videoInfo.data.owner;
        videoCover = videoInfo.data.pic || '';
        if (videoInfo.data.pubdate) {
          try {
            date = new Date(videoInfo.data.pubdate * 1000).toISOString().split('T')[0];
          } catch (e) {
            date = new Date().toISOString().split('T')[0];
          }
        }
      } else {
        return { error: '无法获取视频信息，请确认BV号正确' };
      }
    }
    
    if (!roomId && !bvid) {
      return { error: '无法从URL中提取视频信息，请确认是B站视频链接' };
    }
    
    if (!date) date = new Date().toISOString().split('T')[0];
    
    return { roomId, bvid, date, realUrl, videoTitle, videoOwner, videoCover };
  } catch (error) {
    return { error: 'URL解析失败: ' + error.message };
  }
}

async function fetchDanmakuXML(roomId, date) {
  try {
    const xmlUrl = `https://api.live.bilibili.com/xlive/web-room/v1/dM/gethistory?roomid=${roomId}&date=${date}`;
    const response = await axios.get(xmlUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });

    if (response.data && response.data.code === 0 && response.data.data) {
      const data = response.data.data;
      if (data.room && data.room[0] && data.room[0].danmaku) {
        return response.data;
      }
      
      const detailUrl = `https://api.live.bilibili.com/xlive/web-room/v1/dM/getDMMsgList?roomid=${roomId}&date=${date}`;
      try {
        const detailResponse = await axios.get(detailUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
        });
        if (detailResponse.data && detailResponse.data.code === 0) {
          return detailResponse.data;
        }
      } catch (detailError) {
        // ignore
      }
    }
    return response.data;
  } catch (error) {
    console.error('获取直播回放弹幕数据失败:', error.message);
    return null;
  }
}

async function parseDanmakuXML(xmlData) {
  try {
    const parser = new xml2js.Parser();
    const result = await parser.parseStringPromise(xmlData);
    const danmakus = [];
    
    if (result && result.i && result.i.d) {
      result.i.d.forEach(danmaku => {
        const attr = danmaku.$.p.split(',');
        danmakus.push({
          time: parseFloat(attr[0]),
          type: parseInt(attr[1]),
          size: parseInt(attr[2]),
          color: parseInt(attr[3]),
          timestamp: parseInt(attr[4]),
          pool: parseInt(attr[5]),
          uid: attr[6],
          id: attr[7],
          text: danmaku._ || ''
        });
      });
    }
    return danmakus;
  } catch (error) {
    console.error('解析直播回放XML失败:', error.message);
    return [];
  }
}

function analyzeDanmakuData(danmakus, interval = 60) {
  const stats = {};
  
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
    if (/[\u4e00-\u9fa5]/.test(danmaku.text)) stats[key].chineseCount++;
    if (/[a-zA-Z]/.test(danmaku.text)) stats[key].englishCount++;
    if (/[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/u.test(danmaku.text)) {
      stats[key].withEmoji++;
    }
  });
  
  const counts = Object.values(stats).map(s => s.count);
  const avgCount = counts.reduce((a, b) => a + b, 0) / counts.length;
  const threshold = avgCount * 1.5;
  
  Object.values(stats).forEach(stat => {
    stat.peak = stat.count > threshold;
  });
  
  return Object.values(stats).sort((a, b) => a.startTime - b.startTime);
}

async function extractKeywords(danmakus) {
  try {
    const wordCount = {};
    const stopWords = new Set(['的', '了', '在', '是', '我', '你', '他', '她', '它', '们', '这', '那', '有', '就', '不', '人', '都', '一', '一个', '上', '也', '很', '到', '说', '要', '去', '和', '与', '或', '但', '而', '因为', '所以', '如果', '虽然', '然而', '啊', '吧', '呢', '吗', '哈', '哈哈', '哈哈哈']);
    
    danmakus.forEach(d => {
      const words = d.text.split('').filter(char => 
        /[\u4e00-\u9fa5]/.test(char) && !stopWords.has(char) && char.length > 0
      );
      words.forEach(word => wordCount[word] = (wordCount[word] || 0) + 1);
    });
    
    return Object.entries(wordCount)
      .map(([word, count]) => ({
        word,
        weight: count / danmakus.length,
        count
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20);
  } catch (error) {
    console.error('关键词提取失败:', error);
    return [];
  }
}

// ==========================================
// IPC Handler 注册
// ==========================================

function setupIPC() {
  
  // 1. 核心分析功能
  ipcMain.handle('analyze', async (event, { url }) => {
    if (!url) throw new Error('缺少直播回放URL');
    
    const parsedUrl = await parseLiveReplayUrl(url);
    if (!parsedUrl || parsedUrl.error) throw new Error(parsedUrl?.error || 'URL解析失败');
    if (!parsedUrl.bvid) throw new Error('无法提取BV号');
    
    const cacheKey = `video-${parsedUrl.bvid}`;
    // 强制刷新，不读缓存 (与原逻辑一致)
    
    const vinfoForCover = await getVideoInfo(parsedUrl.bvid);
    const cover = normalizeCoverUrl(vinfoForCover?.data?.pic);
    
    const xmlData = await fetchVideoDanmakuByCID(parsedUrl.bvid);
    if (!xmlData) throw new Error('无法获取弹幕数据');
    
    const danmakus = await parseVideoDanmakuXML(xmlData);
    if (danmakus.length === 0) throw new Error('该视频没有弹幕数据');
    
    const stats = analyzeDanmakuData(danmakus);
    const keywords = await extractKeywords(danmakus);
    
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
    
    danmakuData[cacheKey] = result;
    return result;
  });

  // 2. 获取缓存的弹幕数据
  ipcMain.handle('get-danmaku', async (event, { roomId, date }) => {
    const cacheKey = `${roomId}-${date}`;
    if (danmakuData[cacheKey]) return danmakuData[cacheKey];
    
    const xmlData = await fetchDanmakuXML(roomId, date);
    if (!xmlData) throw new Error('无法获取弹幕数据');
    
    const danmakus = await parseDanmakuXML(xmlData);
    const stats = analyzeDanmakuData(danmakus);
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
    
    danmakuData[cacheKey] = result;
    return result;
  });

  // 3. 搜索弹幕
  ipcMain.handle('search-danmaku', async (event, { roomId, date, keyword }) => {
    if (!keyword) throw new Error('缺少搜索关键词');
    
    const cacheKey = `${roomId}-${date}`;
    let danmakus = [];
    
    if (danmakuData[cacheKey]) {
      danmakus = danmakuData[cacheKey].danmakus;
    } else {
      const xmlData = await fetchDanmakuXML(roomId, date);
      if (xmlData) danmakus = await parseDanmakuXML(xmlData);
    }
    
    const results = danmakus.filter(d => 
      d.text.toLowerCase().includes(keyword.toLowerCase())
    );
    
    return { keyword, results, total: results.length };
  });

  // 4. 获取视频封面
  ipcMain.handle('get-video-cover', async (event, bvid) => {
    const vinfo = await getVideoInfo(bvid);
    const cover = normalizeCoverUrl(vinfo?.data?.pic);
    if (!cover) throw new Error('未找到封面');
    return { cover };
  });

  // 5. 获取下载路径
  ipcMain.handle('get-downloads-path', async () => {
    return { path: path.join(app.getPath('home'), 'Downloads') };
  });

  // 6. 保存封面
  ipcMain.handle('save-cover', async (event, { url, bvid, dir }) => {
    if (!url) throw new Error('missing url');
    
    const targetDir = (dir && dir.trim()) ? dir.trim() : path.join(app.getPath('home'), 'Downloads');
    await fs.mkdir(targetDir, { recursive: true });
    
    const response = await axios.get(url, { responseType: 'arraybuffer', headers: { 'User-Agent': 'Mozilla/5.0' } });
    
    const ct = (response.headers['content-type'] || '').toLowerCase();
    let ext = 'jpg';
    if (ct.includes('png')) ext = 'png';
    else if (ct.includes('webp')) ext = 'webp';
    
    const filename = `cover_${bvid || Date.now()}.${ext}`;
    const filePath = path.join(targetDir, filename);
    await fs.writeFile(filePath, response.data);
    
    return { ok: true, path: filePath };
  });

  // 7. 历史记录管理
  ipcMain.handle('get-history', async () => {
    const arr = await readHistory();
    return arr.sort((a, b) => (b.time || 0) - (a.time || 0));
  });

  ipcMain.handle('add-history', async (event, { upName, upFace, url }) => {
    if (!url) throw new Error('missing url');
    const arr = await readHistory();
    const now = Date.now();
    const map = new Map(arr.map(i => [i.url, i]));
    map.set(url, { time: now, upName, upFace, url });
    const out = Array.from(map.values()).sort((a, b) => (b.time || 0) - (a.time || 0)).slice(0, 100);
    await writeHistory(out);
    return { ok: true };
  });

  ipcMain.handle('delete-history', async (event, { url } = {}) => {
    let arr = await readHistory();
    if (url) {
      arr = arr.filter(i => i.url !== url);
    } else {
      arr = [];
    }
    await writeHistory(arr);
    return { ok: true };
  });

  // 8. UP主合集
  ipcMain.handle('get-up-series', async (event, { url, page, pageSize, excludeBvids }) => {
    if (!url) throw new Error('缺少合集链接');
    
    const match = url.match(/https?:\/\/space\.bilibili\.com\/(\d+)\/lists\/(\d+).*type=series/i);
    if (!match) throw new Error('合集链接格式不正确');
    
    const mid = match[1];
    const sid = match[2];
    const pn = (page > 0) ? page : 1;
    const ps = (pageSize > 0 && pageSize <= 50) ? pageSize : 10;
    
    const cacheKey = `series-${mid}-${sid}-pn${pn}-ps${ps}`;
    if (upSeriesCache[cacheKey] && Date.now() - upSeriesCache[cacheKey].ts < 5 * 60 * 1000) {
       return upSeriesCache[cacheKey].data;
    }
    
    let archives = [];
    let totalCount = 0;
    let hasMore = false;
    const exclude = new Set((excludeBvids || []).map(String));
    
    // 简化版：仅保留API调用方式，省略爬虫 fallback 以精简代码 (API 通常够用)
    try {
      const apiUrl = `https://api.bilibili.com/x/series/archives?mid=${mid}&series_id=${sid}&only_normal=true&sort=desc&pn=${pn}&ps=${ps}`;
      const resp = await axios.get(apiUrl, { 
        headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': `https://space.bilibili.com/${mid}/lists/${sid}?type=series` } 
      });
      if (resp.data?.code === 0 && resp.data.data) {
        archives = resp.data.data.archives || [];
        totalCount = resp.data.data.page?.total || 0;
      }
    } catch (e) {
      console.error('API fetch failed', e);
    }
    
    // 这里简单处理，暂不包含复杂的爬虫fallback逻辑
    
    let upName = '', upFace = '';
    try {
      const info = await getUPInfo(mid);
      if (info?.data) {
        upName = info.data.name;
        upFace = normalizeCoverUrl(info.data.face);
      }
    } catch {}
    
    const list = archives.map(a => ({
      bvid: a.bvid,
      title: a.title || '',
      cover: normalizeCoverUrl(a.pic || ''),
      viewCount: a.stat?.view || 0,
      date: a.pubdate ? new Date(a.pubdate * 1000).toISOString().split('T')[0] : '',
      duration: a.duration || 0,
      url: a.bvid ? `https://www.bilibili.com/video/${a.bvid}` : ''
    })).filter(item => !exclude.has(item.bvid));

    if (totalCount > 0) {
      hasMore = totalCount > (exclude.size + archives.length) && archives.length === ps;
    }
    
    const data = { mid, sid, upName, upFace, list, page: pn, pageSize: ps, hasMore, fetchedAt: new Date().toISOString() };
    upSeriesCache[cacheKey] = { data, ts: Date.now() };
    return data;
  });

  // 9. 清除缓存
  ipcMain.handle('clear-cache', async () => {
    const count = Object.keys(danmakuData).length;
    danmakuData = {};
    return { message: '缓存已清除', clearedCount: count };
  });

  console.log('IPC Handlers initialized');
}

module.exports = { setupIPC };
