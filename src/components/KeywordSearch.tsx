import React, { useState, useEffect } from 'react';
import { Search, Tag, TrendingUp, Eye, EyeOff } from 'lucide-react';

interface Keyword {
  word: string;
  weight: number;
  count: number;
}

interface KeywordSearchProps {
  bvid: string;
  date: string;
  keywords: Keyword[];
}

interface SearchResult {
  keyword: string;
  results: any[];
  total: number;
}

const API_BASE = 'http://localhost:3001/api';

export default function KeywordSearch({ bvid, date, keywords }: KeywordSearchProps) {
  const [searchKeyword, setSearchKeyword] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [showKeywords, setShowKeywords] = useState(false);
  const [selectedKeyword, setSelectedKeyword] = useState<string | null>(null);

  // 搜索弹幕（基于视频BV号）
  const searchDanmaku = async (keyword: string) => {
    if (!keyword.trim() || !bvid || !date) return;

    setLoading(true);
    try {
      // 使用客户端搜索，因为我们已经有了所有弹幕数据
      const results = keywords.filter(k => 
        k.word.toLowerCase().includes(keyword.toLowerCase()) ||
        keyword.toLowerCase().includes(k.word.toLowerCase())
      );
      
      // 模拟搜索结果格式
      const searchResult: SearchResult = {
        keyword: keyword,
        results: results.map(r => ({
          text: `${r.word} (权重: ${r.weight.toFixed(2)}, 次数: ${r.count})`,
          time: 0,
          uid: 'system',
          color: 16777215,
          size: 25
        })),
        total: results.length
      };
      
      setSearchResults(searchResult);
    } catch (error) {
      console.error('搜索请求失败:', error);
    } finally {
      setLoading(false);
    }
  };

  // 处理搜索提交
  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchKeyword.trim()) {
      searchDanmaku(searchKeyword);
    }
  };

  // 点击热词进行搜索
  const handleKeywordClick = (keyword: string) => {
    setSearchKeyword(keyword);
    searchDanmaku(keyword);
    setSelectedKeyword(keyword);
  };

  // 清除搜索结果
  const clearResults = () => {
    setSearchResults(null);
    setSearchKeyword('');
    setSelectedKeyword(null);
  };

  return (
    <div className="bg-white/60 backdrop-blur-sm rounded-xl shadow-sm border border-white/40">
      {/* 热词搜索头部 - 更紧凑 */}
      <div className="p-4 border-b border-gray-200/50">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center space-x-2">
            <Tag className="w-4 h-4 text-gray-600" />
            <h3 className="text-base font-semibold text-gray-900">热词搜索</h3>
          </div>
          
          <button
            onClick={() => setShowKeywords(!showKeywords)}
            className="flex items-center space-x-1 px-2 py-1 text-xs text-blue-600 hover:text-blue-800 transition-colors"
          >
            {showKeywords ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
            <span>{showKeywords ? '隐藏' : '显示'}热词</span>
          </button>
        </div>

        {/* 搜索输入框 - 更紧凑 */}
        <form onSubmit={handleSearch} className="relative">
          <input
            type="text"
            value={searchKeyword}
            onChange={(e) => setSearchKeyword(e.target.value)}
            placeholder="输入关键词搜索弹幕..."
            className="w-full pl-8 pr-16 py-2.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white/80"
          />
          <Search className="absolute left-2.5 top-3 w-3.5 h-3.5 text-gray-400" />
          
          <div className="absolute right-1.5 top-1.5 flex space-x-1">
            <button
              type="submit"
              disabled={loading || !searchKeyword.trim()}
              className="px-3 py-1.5 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-xs font-medium transition-colors"
            >
              {loading ? '搜索...' : '搜索'}
            </button>
            
            {searchResults && (
              <button
                type="button"
                onClick={clearResults}
                className="px-2 py-1.5 bg-gray-500 text-white rounded-md hover:bg-gray-600 text-xs font-medium transition-colors"
              >
                清除
              </button>
            )}
          </div>
        </form>
      </div>

      {/* 热词列表 - 更紧凑 */}
      {showKeywords && keywords && keywords.length > 0 && (
        <div className="p-4 border-b border-gray-200/50">
          <h4 className="text-xs font-medium text-gray-600 mb-2 uppercase tracking-wide">热门关键词</h4>
          <div className="flex flex-wrap gap-1.5">
            {keywords.slice(0, 12).map((keyword, index) => (
              <button
                key={keyword.word}
                onClick={() => handleKeywordClick(keyword.word)}
                className={`px-2 py-1 rounded-full text-xs font-medium transition-all hover:scale-105 ${
                  selectedKeyword === keyword.word
                    ? 'bg-blue-600 text-white shadow-md'
                    : index < 3
                    ? 'bg-red-100 text-red-800 hover:bg-red-200'
                    : index < 6
                    ? 'bg-orange-100 text-orange-800 hover:bg-orange-200'
                    : index < 9
                    ? 'bg-yellow-100 text-yellow-800 hover:bg-yellow-200'
                    : 'bg-gray-100 text-gray-800 hover:bg-gray-200'
                }`}
                title={`权重: ${keyword.weight.toFixed(2)}, 出现次数: ${keyword.count}`}
              >
                <span className="flex items-center space-x-1">
                  <span>{keyword.word}</span>
                  {index < 3 && <TrendingUp className="w-2.5 h-2.5" />}
                </span>
              </button>
            ))}
          </div>
          
          <div className="mt-2 text-xs text-gray-500">
            点击关键词可直接搜索，颜色表示热度等级
          </div>
        </div>
      )}

      {/* 搜索结果 - 更紧凑 */}
      {searchResults && (
        <div className="p-4">
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-medium text-gray-700">
              搜索结果: "{searchResults.keyword}" ({searchResults.total} 条)
            </h4>
            <button
              onClick={clearResults}
              className="text-xs text-gray-500 hover:text-gray-700 transition-colors"
            >
              关闭结果
            </button>
          </div>

          {searchResults.results.length === 0 ? (
            <div className="text-center py-6 text-gray-500">
              <Tag className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">未找到包含 "{searchResults.keyword}" 的弹幕</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {searchResults.results.slice(0, 30).map((danmaku, index) => (
                <div key={index} className="bg-gray-50/70 rounded-lg p-2.5 hover:bg-gray-100/70 transition-colors">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <p className="text-sm text-gray-900 leading-relaxed">
                        {danmaku.text.split(searchResults.keyword).map((part, i) => (
                          i === 0 ? part : (
                            <React.Fragment key={i}>
                              <span className="bg-yellow-200 px-1 rounded font-medium">
                                {searchResults.keyword}
                              </span>
                              {part}
                            </React.Fragment>
                          )
                        ))}
                      </p>
                    </div>
                  </div>
                  
                  <div className="flex items-center justify-between mt-1.5 text-xs text-gray-500">
                    <div className="flex items-center space-x-3">
                      <span>时间: {formatTime(danmaku.time)}</span>
                      <span>用户: {danmaku.uid}</span>
                    </div>
                    <div className="flex items-center space-x-2">
                      {danmaku.color && (
                        <span 
                          className="inline-block w-2.5 h-2.5 rounded-full border border-gray-300"
                          style={{ backgroundColor: `#${danmaku.color.toString(16).padStart(6, '0')}` }}
                          title="弹幕颜色"
                        />
                      )}
                      <span>大小: {danmaku.size}</span>
                    </div>
                  </div>
                </div>
              ))}
              
              {searchResults.results.length > 30 && (
                <div className="text-center py-2 text-xs text-gray-500">
                  显示前30条结果，共{searchResults.total}条
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

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