const axios = require('axios');
const xml2js = require('xml2js');

async function testVideoDanmaku() {
  try {
    // 测试一个B站视频的弹幕
    const bvid = 'BV1GJ411x7h7'; // 这是一个示例BV号
    console.log('测试BV号:', bvid);
    
    // 获取CID
    const cidResponse = await axios.get(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });
    
    if (!cidResponse.data || !cidResponse.data.data || !cidResponse.data.data.cid) {
      console.log('无法获取CID');
      return;
    }
    
    const cid = cidResponse.data.data.cid;
    console.log('获取到CID:', cid);
    
    // 获取弹幕XML
    const danmakuUrl = `https://api.bilibili.com/x/v1/dm/list.so?oid=${cid}`;
    console.log('弹幕URL:', danmakuUrl);
    
    const danmakuResponse = await axios.get(danmakuUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      responseType: 'arraybuffer'
    });
    
    const xmlData = Buffer.from(danmakuResponse.data).toString('utf-8');
    console.log('XML数据长度:', xmlData.length);
    console.log('XML前500字符:', xmlData.substring(0, 500));
    
    // 解析XML
    const parser = new xml2js.Parser();
    const result = await parser.parseStringPromise(xmlData);
    
    if (result && result.i && result.i.d) {
      console.log('找到弹幕数量:', result.i.d.length);
      
      // 检查前几个弹幕的时间戳
      const firstFew = result.i.d.slice(0, 10).map(d => {
        const attr = d.$.p.split(',');
        return parseFloat(attr[0]);
      });
      
      console.log('前10个弹幕时间戳:', firstFew);
      
      // 检查时间间隔
      const intervals = [];
      for (let i = 1; i < firstFew.length; i++) {
        intervals.push(firstFew[i] - firstFew[i-1]);
      }
      
      console.log('时间间隔:', intervals);
    }
    
  } catch (error) {
    console.error('测试失败:', error.message);
  }
}

testVideoDanmaku();