// 测试API的脚本
async function testAPI() {
  try {
    const testUrl = 'https://www.bilibili.com/video/BV1GJ411x7h7/'; // 示例视频URL
    
    console.log('测试API，URL:', testUrl);
    
    const response = await fetch('http://localhost:3001/api/analyze', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url: testUrl }),
    });
    
    const data = await response.json();
    
    if (response.ok) {
      console.log('API调用成功');
      console.log('弹幕总数:', data.totalDanmakus);
      console.log('统计段数量:', data.stats.length);
      
      if (data.stats.length > 0) {
        console.log('前5个统计段:');
        data.stats.slice(0, 5).forEach((stat, index) => {
          console.log(`  ${index + 1}. ${stat.startTime}-${stat.endTime}秒: ${stat.count}条弹幕`);
        });
      }
    } else {
      console.log('API调用失败:', data.error);
    }
  } catch (error) {
    console.error('测试失败:', error.message);
  }
}

testAPI();