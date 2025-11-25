// 测试前端应用的脚本
async function testFrontend() {
  try {
    // 测试一个B站视频URL
    const testUrl = 'https://www.bilibili.com/video/BV1GJ411x7h7/';
    
    console.log('测试前端应用，URL:', testUrl);
    
    // 模拟前端调用
    const response = await fetch('http://localhost:3001/api/analyze', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url: testUrl }),
    });
    
    const data = await response.json();
    
    if (response.ok) {
      console.log('✅ API调用成功');
      console.log('📊 弹幕总数:', data.totalDanmakus);
      console.log('📈 统计段数量:', data.stats.length);
      console.log('⏱️  时间范围:', data.stats[0]?.startTime, '到', data.stats[data.stats.length-1]?.endTime);
      
      console.log('\n📋 详细统计:');
      data.stats.forEach((stat, index) => {
        const startTime = Math.floor(stat.startTime / 60);
        const endTime = Math.floor(stat.endTime / 60);
        console.log(`${index + 1}. ${startTime}:${(stat.startTime % 60).toString().padStart(2, '0')} - ${endTime}:${(stat.endTime % 60).toString().padStart(2, '0')}: ${stat.count}条弹幕`);
      });
      
      // 检查是否都是1分钟间隔
      const allOneMinute = data.stats.every(stat => stat.endTime - stat.startTime === 60);
      console.log('\n✅ 所有间隔都是1分钟:', allOneMinute);
      
      return data;
    } else {
      console.log('❌ API调用失败:', data.error);
    }
  } catch (error) {
    console.error('❌ 测试失败:', error.message);
  }
}

testFrontend();