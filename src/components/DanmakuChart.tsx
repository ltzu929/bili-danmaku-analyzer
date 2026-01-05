import React, { useMemo } from 'react';
import {
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
  ReferenceLine,
  Label
} from 'recharts';
import { BarChart3 } from 'lucide-react';

interface DanmakuItem {
  time?: number;
  timePoint?: number;
  content?: string;
  text?: string;
}

interface ChartData {
  startTime: number;
  endTime: number;
  count: number;
  chineseCount: number;
  englishCount: number;
  withEmoji: number;
  peak: boolean;
}

type FilterMode = 'all' | 'call' | 'ha' | 'cao' | 'question'

interface ChartOptions {
  showAll: boolean;
  showPeakOnly: boolean;
  showWithEmoji: boolean;
  highPrecision: boolean;
  smoothLine: boolean;
  filterMode: FilterMode;
}

interface DanmakuChartProps {
  data: ChartData[];
  options: ChartOptions;
  danmakus?: DanmakuItem[];
  onTimeSelect?: (time: number) => void;
  highlightTime?: number | null;
}

/**
 * 生成X轴刻度点（每1分钟显示一个刻度）
 */
const generateTicks = (data: ChartData[]): number[] => {
  if (data.length === 0) return [];
  
  const ticks: number[] = [];
  const startTime = data[0].startTime;
  const endTime = data[data.length - 1].endTime;
  
  // 每60秒显示一个刻度
  for (let time = startTime; time <= endTime; time += 60) {
    ticks.push(time);
  }
  
  return ticks;
};

/**
 * 格式化时间（秒转换为时分秒格式）
 */
const formatTime = (seconds: number): string => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
};

/**
 * 文本归一化（用于合并变体，如 哈哈哈/？？？ 等）
 */
const normalizeContent = (text: string): string => {
  let s = (text || '').trim();
  if (!s) return '';
  s = s.replace(/\?/g, '？').replace(/!/g, '！').toLowerCase();
  s = s.replace(/[？！？、，。.\-~～]{2,}/gu, (m) => m[0]);
  s = s.replace(/(.)\1{2,}/gu, '$1$1');
  if (/^[？]+$/u.test(s)) return '？';
  if (/^[！]+$/u.test(s)) return '！';
  if (/^(哈)+$/u.test(s)) return '哈哈';
  if (/^(啊)+$/u.test(s)) return '啊啊';
  if (/^(嘿)+$/u.test(s)) return '嘿嘿';
  if (/^(呵)+$/u.test(s)) return '呵呵';
  if (/^(嘻)+$/u.test(s)) return '嘻嘻';
  return s;
};

/**
 * 计算指定时间段内某类弹幕的数量
 */
const segmentCategoryCount = (danmakus: DanmakuItem[], start: number, end: number, mode: FilterMode): number => {
  if (mode === 'all') return 0;
  let cnt = 0;
  for (const d of danmakus || []) {
    const t = d.time || d.timePoint || 0;
    if (t >= start && t < end) {
      const c = normalizeContent(d.content || d.text || '');
      if (!c) continue;
      if (mode === 'ha') {
        if (c.includes('哈哈')) cnt++;
      } else if (mode === 'cao') {
        if (c.includes('草')) cnt++;
      } else if (mode === 'question') {
        if (c.includes('？')) cnt++;
      } else if (mode === 'call') {
        if (c.includes('打call') || c.includes('call') || c.includes('定位') || c.includes('应援')) cnt++;
      }
    }
  }
  return cnt;
};

/**
 * 自定义Tooltip组件
 */
interface CustomTooltipProps {
  active?: boolean;
  payload?: { payload: ChartData }[];
  label?: string;
  danmakus: DanmakuItem[];
}

const CustomTooltip = ({ active, payload, danmakus }: CustomTooltipProps) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    // 读取设置
    let topCount = 5;
    let timeWindow = 30;
    let mergeSimilar = true;
    try {
      const raw = localStorage.getItem('app_settings');
      if (raw) {
        const s = JSON.parse(raw);
        if (typeof s.topHotwords === 'number') topCount = s.topHotwords;
        if (typeof s.tooltipWindowSeconds === 'number') timeWindow = s.tooltipWindowSeconds;
        if (typeof s.mergeSimilar === 'boolean') mergeSimilar = s.mergeSimilar;
      }
    } catch {
      // ignore error
    }
    const currentTime = data.startTime + 30;
    
    const nearbyDanmakus = danmakus.filter((d: DanmakuItem) => {
      const danmakuTime = d.time || d.timePoint || 0;
      return Math.abs(danmakuTime - currentTime) <= timeWindow;
    });

    // 统计相同内容的弹幕数量
    const contentCount: { [key: string]: number } = {};
    nearbyDanmakus.forEach((d: DanmakuItem) => {
      const raw = d.content || d.text || '';
      const content = mergeSimilar ? normalizeContent(raw) : (raw || '').trim();
      if (content.length > 0) {
        contentCount[content] = (contentCount[content] || 0) + 1;
      }
    });

    // 获取数量最多的前5个弹幕
    // 业务要求：悬浮窗仅展示热词数量排名前五，避免信息过载影响阅读
    const topDanmakus = Object.entries(contentCount)
      .map(([content, count]) => ({ content, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, Math.max(1, topCount));

    return (
      <div className="bg-white p-4 border border-gray-200 rounded-lg shadow-xl">
        {/* 时间信息 */}
        <p className="font-medium text-gray-900 mb-2">
          时间: {formatTime(data.startTime)}
        </p>
        <p className="text-sm text-gray-600 mb-3">
          总弹幕数: <span className="font-medium text-blue-600">{data.count}</span>
        </p>
        
        {/* 弹幕热词列表 */}
        {topDanmakus.length > 0 && (
          <div className="border-t border-gray-100 pt-3">
            <p className="text-xs font-medium text-gray-700 mb-2">弹幕热词（前{Math.max(1, topCount)}）:</p>
            <div className="space-y-1">
              {topDanmakus.map((danmaku, index) => (
                <div key={index} className="flex items-center justify-between text-xs">
                  <span className="text-gray-800 truncate mr-2" title={danmaku.content}>
                    {danmaku.content}
                  </span>
                  <span className="text-gray-500 bg-gray-100 px-1 py-0.5 rounded">
                    {danmaku.count}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
        
        {/* 统计信息 */}
        <div className="mt-3 pt-3 border-t border-gray-100">
          
          {data.withEmoji > 0 && (
            <p className="text-xs text-gray-600">
              带表情弹幕: <span className="text-orange-600">{data.withEmoji}</span>
            </p>
          )}
          {data.peak && (
            <p className="text-xs text-red-600 font-medium mt-1">🔥 高峰时段</p>
          )}
        </div>
      </div>
    );
  }
  return null;
};

export default function DanmakuChart({ data, options, danmakus, onTimeSelect, highlightTime }: DanmakuChartProps) {
  // 根据选项过滤数据
  const chartData = useMemo(() => {
    if (!data || data.length === 0) return [];
    
    let filteredData = [...data];

    // 如果只显示高峰
    if (options.showPeakOnly) {
      filteredData = filteredData.filter(item => item.peak);
    }

    if (options.showWithEmoji) {
      filteredData = filteredData.filter(item => item.withEmoji > 0);
    }
    
    // 平滑数据（移动平均）
    if (!options.smoothLine || filteredData.length < 3) return filteredData;

    const smoothed = [...filteredData];
    for (let i = 1; i < filteredData.length - 1; i++) {
      let sum = 0;
      let count = 0;
      for (let j = -1; j <= 1; j++) {
        if (i + j >= 0 && i + j < filteredData.length) {
          sum += filteredData[i + j].count;
          count++;
        }
      }
      smoothed[i] = {
        ...smoothed[i],
        count: Math.round(sum / count)
      };
    }
    
    return smoothed;
  }, [data, options.showPeakOnly, options.showWithEmoji, options.smoothLine]);

  // 分类过滤：仅显示指定类别密度
  const finalData = useMemo(() => {
    if (!danmakus || !danmakus.length) return chartData;
    if (!options.filterMode || options.filterMode === 'all') return chartData;
    
    const next: ChartData[] = [];
    for (const item of chartData) {
      const c = segmentCategoryCount(danmakus, item.startTime, item.endTime, options.filterMode);
      if (c > 0) {
        next.push({ ...item, count: c });
      }
    }
    return next.length ? next : chartData;
  }, [chartData, danmakus, options.filterMode]);

  if (finalData.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-500">
        <div className="text-center">
          <BarChart3 className="w-12 h-12 mx-auto mb-2 opacity-50" />
          <p>没有符合筛选条件的数据</p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full">
      {/* 主图表 - 更现代的设计 */}
      <div className="h-72 mb-3">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart 
            data={finalData} 
            margin={{ top: 5, right: 5, left: 5, bottom: 5 }}
            onClick={(e) => {
              if (e && e.activeLabel && onTimeSelect) {
                onTimeSelect(Number(e.activeLabel));
              }
            }}
          >
            <defs>
              <linearGradient id="colorCount" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.4}/>
                <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.05}/>
              </linearGradient>
              <linearGradient id="colorPeak" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#ef4444" stopOpacity={0.6}/>
                <stop offset="100%" stopColor="#ef4444" stopOpacity={0.1}/>
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" strokeOpacity={0.5} />
            <XAxis 
              dataKey="startTime" 
              tickFormatter={formatTime}
              stroke="#6b7280"
              fontSize={11}
              tickLine={false}
              axisLine={false}
              ticks={generateTicks(chartData)}
              type="number"
              domain={['dataMin', 'dataMax']}
            />
            <YAxis 
              stroke="#6b7280" 
              fontSize={11}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip 
              content={<CustomTooltip danmakus={danmakus || []} />} 
              cursor={{ stroke: '#3b82f6', strokeWidth: 1, strokeDasharray: '4 4' }}
            />
            {typeof highlightTime === 'number' && (
              <ReferenceLine x={highlightTime} stroke="#ef4444" strokeDasharray="3 3" isFront>
                <Label value={formatTime(highlightTime)} position="top" fill="#ef4444" fontSize={12} />
              </ReferenceLine>
            )}
            <Area
              type={options.smoothLine ? "monotone" : "linear"}
              dataKey="count"
              stroke="#3b82f6"
              strokeWidth={2.5}
              fill="url(#colorCount)"
              dot={false}
              activeDot={false}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>


    </div>
  );
}