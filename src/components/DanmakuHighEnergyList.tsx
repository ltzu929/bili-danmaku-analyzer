import React, { useMemo } from 'react';
import { Flame, PlayCircle } from 'lucide-react';

interface DanmakuItem {
  time?: number;
  timePoint?: number;
  content?: string;
  text?: string;
}

interface HighEnergyPoint {
  time: number;
  score: number; // 窗口内的弹幕密度得分
  preview?: string; // 那个时刻最热门的弹幕内容
}

interface DanmakuHighEnergyListProps {
  danmakus: DanmakuItem[];
  duration?: number; // 视频总时长（秒），可选，用于边界检查
  onTimeSelect: (time: number) => void;
  onHover?: (time: number | null) => void;
  sensitivity?: 'low' | 'medium' | 'high';
}

// 格式化时间辅助函数
const formatTime = (seconds: number): string => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
};

// 文本归一化（用于合并变体，如 哈哈哈/？？？ 等）
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

export default function DanmakuHighEnergyList({ danmakus, onTimeSelect, onHover, sensitivity = 'medium' }: DanmakuHighEnergyListProps) {
  
  // 核心算法：计算高能时刻 + 热门内容
  const highEnergyPoints = useMemo(() => {
    if (!danmakus || danmakus.length === 0) return [];

    // 1. 数据预处理：提取所有弹幕时间并排序
    // 同时保留原始对象引用以便后续查找内容，构建 time -> items 索引或直接按时间排序整个对象数组
    // 这里为了效率，我们先对 danmakus 进行排序
    const sortedDanmakus = [...danmakus].sort((a, b) => {
      const ta = a.time || a.timePoint || 0;
      const tb = b.time || b.timePoint || 0;
      return ta - tb;
    });
    
    const times = sortedDanmakus.map(d => d.time || d.timePoint || 0);
    
    if (times.length === 0) return [];

    const minTime = times[0];
    const maxTime = times[times.length - 1];
    const totalDuration = maxTime - minTime;

    if (totalDuration <= 0) return [];

    // 2. 滑动窗口密度计算
    const windowSize = 30; // 30秒窗口
    const step = 1;
    
    const densities: HighEnergyPoint[] = [];

    let left = 0;
    let right = 0;
    
    for (let t = minTime; t <= maxTime; t += step) {
      const windowStart = t - windowSize / 2;
      const windowEnd = t + windowSize / 2;

      while (right < times.length && times[right] <= windowEnd) {
        right++;
      }
      while (left < times.length && times[left] < windowStart) {
        left++;
      }

      const count = right - left;
      
      // 只有当密度足够高时，才值得记录（初步筛选，减少后续计算量）
      // 这里先简单记录，后续统一过滤
      if (count > 0) {
        densities.push({ time: t, score: count });
      }
    }

    // 3. 动态阈值过滤
    const totalCount = times.length;
    const avgDensity = (totalCount / totalDuration) * windowSize;
    
    // 根据灵敏度设置阈值倍数
    const thresholdMultiplier = sensitivity === 'high' ? 1.4 : sensitivity === 'low' ? 2.2 : 1.8;
    const threshold = avgDensity * thresholdMultiplier;

    const candidates = densities.filter(p => p.score >= threshold);

    // 4. 非极大值抑制 (NMS) 去重
    candidates.sort((a, b) => b.score - a.score);

    const result: HighEnergyPoint[] = [];
    // 根据灵敏度调整抑制半径
    // Low=300s(5m), Medium=180s(3m), High=90s(1.5m)
    const suppressionRadius = sensitivity === 'high' ? 90 : sensitivity === 'low' ? 300 : 180;

    // 根据灵敏度和视频时长动态计算最大显示数量
    // 每15分钟允许1个高能时刻，最少5个
    const baseMax = Math.max(5, Math.ceil(totalDuration / 900));
    // 上限根据灵敏度调整：Low=8, Medium=15, High=25
    const maxCap = sensitivity === 'high' ? 25 : sensitivity === 'low' ? 8 : 15;
    const maxPoints = Math.min(maxCap, baseMax);

    for (const candidate of candidates) {
      const isSuppressed = result.some(
        selected => Math.abs(selected.time - candidate.time) < suppressionRadius
      );

      if (!isSuppressed) {
        // 计算该窗口内的热门弹幕内容
        const windowStart = candidate.time - windowSize / 2;
        const windowEnd = candidate.time + windowSize / 2;
        
        // 找到窗口内的弹幕
        // 由于 sortedDanmakus 是有序的，我们可以用二分查找或简单的遍历（考虑到已经拿到了 candidate，其实可以在 densities 构建时就存索引范围，但为了代码简单这里重新遍历一下片段）
        // 优化：我们可以复用之前的滑动窗口逻辑，但这里只对 Top 5 进行计算，开销不大
        const windowItems = sortedDanmakus.filter(d => {
            const t = d.time || d.timePoint || 0;
            return t >= windowStart && t <= windowEnd;
        });

        // 统计内容
        const contentCount: { [key: string]: number } = {};
        for (const item of windowItems) {
            const raw = item.content || item.text || '';
            const normalized = normalizeContent(raw);
            if (normalized) {
                contentCount[normalized] = (contentCount[normalized] || 0) + 1;
            }
        }

        // 找 Top 1
        let topContent = '';
        let maxCount = 0;
        for (const [content, count] of Object.entries(contentCount)) {
            if (count > maxCount) {
                maxCount = count;
                topContent = content;
            }
        }

        result.push({ ...candidate, preview: topContent });
      }

      if (result.length >= maxPoints) break;
    }

    return result.sort((a, b) => a.time - b.time);

  }, [danmakus, sensitivity]);

  if (highEnergyPoints.length === 0) {
    return null;
  }

  return (
    <div className="bg-white/70 backdrop-blur-sm rounded-xl shadow-sm border border-white/50 p-4 mt-4">
      <div className="flex items-center space-x-2 mb-3">
        <Flame className="w-5 h-5 text-red-500" />
        <h3 className="font-semibold text-gray-900">高能时刻</h3>
        <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
          智能识别
        </span>
      </div>
      
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
        {highEnergyPoints.map((point, index) => (
          <button
            key={index}
            onClick={() => onTimeSelect(point.time)}
            onMouseEnter={() => onHover?.(point.time)}
            onMouseLeave={() => onHover?.(null)}
            className="group relative flex flex-col items-center justify-center p-3 bg-white border border-gray-100 rounded-lg hover:border-blue-300 hover:shadow-md transition-all active:scale-95 text-center w-full"
          >
            <div className="text-lg font-bold text-gray-800 mb-1 group-hover:text-blue-600">
              {formatTime(point.time)}
            </div>
            
            {/* 热门内容预览 */}
            {point.preview && (
                <div className="text-xs text-gray-600 mb-1.5 px-1 truncate w-full" title={point.preview}>
                    {point.preview}
                </div>
            )}

            <div className="flex items-center text-xs text-gray-500">
              <span className="bg-red-50 text-red-600 px-1.5 py-0.5 rounded flex items-center">
                <Flame className="w-3 h-3 mr-0.5 fill-current" />
                {point.score}
              </span>
            </div>
            
            <div className="absolute inset-0 flex items-center justify-center bg-white/90 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg">
                <span className="text-blue-600 font-medium flex items-center">
                    <PlayCircle className="w-5 h-5 mr-1" />
                    跳转
                </span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
