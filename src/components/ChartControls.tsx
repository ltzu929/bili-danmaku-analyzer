import React from 'react';
import { Settings, Filter, TrendingUp, Globe, Smile, Zap } from 'lucide-react';

interface ChartOptions {
  showAll: boolean;
  showPeakOnly: boolean;
  showWithEmoji: boolean;
  highPrecision: boolean;
  smoothLine: boolean;
}

interface ChartControlsProps {
  options: ChartOptions;
  onOptionsChange: (options: ChartOptions) => void;
}

export default function ChartControls({ options, onOptionsChange }: ChartControlsProps) {
  const handleOptionChange = (key: keyof ChartOptions, value: boolean) => {
    onOptionsChange({
      ...options,
      [key]: value
    });
  };

  const handleRadioChange = (selectedOption: string) => {
    onOptionsChange({
      ...options,
      showAll: selectedOption === 'all',
      showPeakOnly: selectedOption === 'peak',
      showWithEmoji: selectedOption === 'emoji'
    });
  };

  return (
    <div className="bg-white/60 backdrop-blur-sm rounded-xl shadow-sm border border-white/40 p-4 h-fit">
      <div className="flex items-center space-x-2 mb-4">
        <Settings className="w-4 h-4 text-gray-600" />
        <h3 className="text-base font-semibold text-gray-900">图表控制</h3>
      </div>

      {/* 显示选项 - 紧凑单选 */}
      <div className="mb-4">
        <h4 className="text-xs font-medium text-gray-600 mb-2 uppercase tracking-wide">筛选模式</h4>
        <div className="space-y-1.5">
          <label className="flex items-center space-x-2 cursor-pointer group">
            <input
              type="radio"
              name="displayOption"
              checked={options.showAll}
              onChange={() => handleRadioChange('all')}
              className="text-blue-600 focus:ring-blue-500 w-3.5 h-3.5"
            />
            <Globe className="w-3.5 h-3.5 text-gray-400 group-hover:text-gray-600" />
            <span className="text-xs text-gray-700">全部</span>
          </label>

          <label className="flex items-center space-x-2 cursor-pointer group">
            <input
              type="radio"
              name="displayOption"
              checked={options.showPeakOnly}
              onChange={() => handleRadioChange('peak')}
              className="text-blue-600 focus:ring-blue-500 w-3.5 h-3.5"
            />
            <TrendingUp className="w-3.5 h-3.5 text-gray-400 group-hover:text-gray-600" />
            <span className="text-xs text-gray-700">高峰</span>
          </label>

          

          <label className="flex items-center space-x-2 cursor-pointer group">
            <input
              type="radio"
              name="displayOption"
              checked={options.showWithEmoji}
              onChange={() => handleRadioChange('emoji')}
              className="text-blue-600 focus:ring-blue-500 w-3.5 h-3.5"
            />
            <Smile className="w-3.5 h-3.5 text-gray-400 group-hover:text-gray-600" />
            <span className="text-xs text-gray-700">表情</span>
          </label>
        </div>
      </div>

      {/* 图表设置 - 紧凑复选框 */}
      <div className="mb-4">
        <h4 className="text-xs font-medium text-gray-600 mb-2 uppercase tracking-wide">图表选项</h4>
        <div className="space-y-2">
          <label className="flex items-center space-x-2 cursor-pointer group">
            <input
              type="checkbox"
              checked={options.highPrecision}
              onChange={(e) => handleOptionChange('highPrecision', e.target.checked)}
              className="text-blue-600 focus:ring-blue-500 rounded w-3.5 h-3.5"
            />
            <Zap className="w-3.5 h-3.5 text-gray-400 group-hover:text-gray-600" />
            <span className="text-xs text-gray-700">高精度修正</span>
          </label>

          <label className="flex items-center space-x-2 cursor-pointer group">
            <input
              type="checkbox"
              checked={options.smoothLine}
              onChange={(e) => handleOptionChange('smoothLine', e.target.checked)}
              className="text-blue-600 focus:ring-blue-500 rounded w-3.5 h-3.5"
            />
            <Filter className="w-3.5 h-3.5 text-gray-400 group-hover:text-gray-600" />
            <span className="text-xs text-gray-700">平滑曲线</span>
          </label>
        </div>
      </div>

      {/* 紧凑统计信息 */}
      <div className="pt-3 border-t border-gray-200/50">
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="bg-blue-50/50 p-2 rounded">
            <div className="text-blue-600 text-xs">筛选</div>
            <div className="text-blue-900 font-semibold text-xs">
              {options.showAll ? '全部' :
               options.showPeakOnly ? '高峰' :
               options.showWithEmoji ? '表情' : '自定义'}
            </div>
          </div>
          <div className="bg-green-50/50 p-2 rounded">
            <div className="text-green-600 text-xs">平滑</div>
            <div className="text-green-900 font-semibold text-xs">
              {options.smoothLine ? '启用' : '禁用'}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}