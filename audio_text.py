# -*- coding: utf-8 -*-
# 音频转文字模块 - 使用腾讯云ASR服务将音频文件转换为文本
# 本模块实现了音频文件的自动监控、上传、语音识别和字幕生成功能
import configparser  # 用于读取配置文件
import json  # 用于处理JSON数据
import logging  # 用于日志记录
import os  # 用于文件和路径操作
import time  # 用于时间相关操作和延迟
from watchdog.observers import Observer  # 用于监控文件系统变化
from watchdog.events import FileSystemEventHandler  # 用于处理文件系统事件
from tencentcloud.common import credential  # 腾讯云API认证
from tencentcloud.common.profile.client_profile import ClientProfile  # 腾讯云客户端配置
from tencentcloud.common.profile.http_profile import HttpProfile  # 腾讯云HTTP配置
from tencentcloud.common.exception.tencent_cloud_sdk_exception import TencentCloudSDKException  # 腾讯云SDK异常
from tencentcloud.asr.v20190614 import asr_client, models as asr_models  # 腾讯云语音识别服务
from qcloud_cos import CosConfig, CosS3Client  # 腾讯云对象存储服务

# --- 日志配置 ---
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

# --- 加载配置 ---
# 获取当前脚本所在目录
script_dir = os.path.dirname(os.path.abspath(__file__))
# 构造config.ini的绝对路径
config_path = os.path.join(script_dir, 'config.ini')

# 读取 config.ini 配置文件
config = configparser.ConfigParser()
config.read(config_path, encoding='utf-8') # 指定utf-8编码以支持中文

# --- 腾讯云凭证 ---
# 从 config.ini 文件中读取您的腾讯云API密钥和配置
SECRET_ID = config.get('TencentCloud', 'SecretId')
SECRET_KEY = config.get('TencentCloud', 'SecretKey')
REGION = config.get('TencentCloud', 'Region')
BUCKET = config.get('TencentCloud', 'Bucket')

# --- Watchdog 监控配置 ---
# 从 config.ini 文件中读取要监控的文件夹路径和支持的音频格式
WATCH_PATH = os.path.abspath(config.get('Watch', 'WatchPath'))
AUDIO_FORMATS = tuple(config.get('Watch', 'AudioFormats').split(','))

def upload_to_cos(file_path):
    """
    将音频文件上传到腾讯云对象存储(COS)并返回可访问的URL。
    
    :param file_path: 本地音频文件的完整路径
    :return: 上传成功后的文件URL，上传失败则返回None
    """
    # 此函数负责将本地音频文件上传到腾讯云COS存储，并生成一个临时访问链接供ASR服务使用
    try:
        logging.info(f"开始上传文件 {file_path} 到COS...")
        # 初始化COS客户端
        cos_config = CosConfig(Region=REGION, SecretId=SECRET_ID, SecretKey=SECRET_KEY)
        cos_client = CosS3Client(cos_config)

        file_name = os.path.basename(file_path)

        # 打开并上传文件
        with open(file_path, 'rb') as f:
            response = cos_client.put_object(
                Bucket=BUCKET,
                Body=f,
                Key=file_name,
                EnableMD5=False
            )

        # 为ASR（语音识别）生成一个临时的、带签名的访问URL
        url = cos_client.get_presigned_url(
            Method='GET',
            Bucket=BUCKET,
            Key=file_name,
            Expired=3600  # URL有效期为1小时
        )
        logging.info(f"文件 {file_name} 成功上传到COS。URL: {url}")
        return url
    except Exception as e:
        logging.error(f"上传 {file_path} 到COS失败: {e}")
        return None


def create_asr_task(file_url):
    """
    创建一个腾讯云语音识别（ASR）任务。
    
    :param file_url: 音频文件的COS URL
    :return: 创建成功返回任务ID，失败返回None
    """
    try:
        logging.info("正在创建ASR任务...")
        # 初始化ASR客户端
        cred = credential.Credential(SECRET_ID, SECRET_KEY)
        http_profile = HttpProfile(endpoint="asr.tencentcloudapi.com")
        client_profile = ClientProfile(httpProfile=http_profile)
        client = asr_client.AsrClient(cred, REGION, client_profile)

        req = asr_models.CreateRecTaskRequest()
        # 配置ASR任务参数
        params = {
            "EngineModelType": "16k_zh",  # 引擎模型类型，中文普通话
            "ChannelNum": 1,              # 音频声道数
            "ResTextFormat": 3,           # 识别结果返回形式（3表示返回带时间戳的句子级别详情）
            "SourceType": 0,              # 音频来源 (0 表示来自URL)
            "Url": file_url               # 音频的URL
        }
        req.from_json_string( json.dumps(params))

        # 发起请求并获取任务ID
        resp = client.CreateRecTask(req)
        task_id = resp.Data.TaskId
        logging.info(f"ASR任务创建成功。任务ID: {task_id}")
        return task_id
    except TencentCloudSDKException as e:
        logging.error(f"创建ASR任务失败: {e}")
        return None


def poll_asr_task(task_id):
    """
    轮询ASR任务状态，直到任务完成或失败。
    
    :param task_id: 腾讯云ASR任务ID
    :return: 任务成功时返回识别结果，失败返回None
    """
    try:
        # 初始化ASR客户端
        cred = credential.Credential(SECRET_ID, SECRET_KEY)
        http_profile = HttpProfile(endpoint="asr.tencentcloudapi.com")
        client_profile = ClientProfile(httpProfile=http_profile)
        client = asr_client.AsrClient(cred, REGION, client_profile)

        req = asr_models.DescribeTaskStatusRequest()
        params = {"TaskId": task_id}
        req.from_json_string( json.dumps(params))

        # 循环查询任务状态
        while True:
            resp = client.DescribeTaskStatus(req)
            status = resp.Data.StatusStr
            logging.info(f"正在查询ASR任务 {task_id}。当前状态: {status}")
            if status == 'success': # 任务成功
                logging.info(f"ASR任务 {task_id} 已完成。")
                return resp.Data.ResultDetail
            elif status == 'failed': # 任务失败
                logging.error(f"ASR任务 {task_id} 失败。")
                return None
            time.sleep(5)  # 每隔5秒查询一次
    except TencentCloudSDKException as e:
        logging.error(f"查询ASR任务状态失败: {e}")
        return None


def format_time(ms):
    """
    将毫秒转换为SRT字幕时间格式 (HH:MM:SS,ms)。
    
    :param ms: 毫秒时间戳
    :return: 格式化的SRT时间字符串，格式为 HH:MM:SS,ms
    """
    seconds, milliseconds = divmod(ms, 1000)
    minutes, seconds = divmod(seconds, 60)
    hours, minutes = divmod(minutes, 60)
    return f"{hours:02d}:{minutes:02d}:{seconds:02d},{milliseconds:03d}"


def generate_srt(result_detail, srt_path):
    """根据ASR结果生成SRT字幕文件。"""
    try:
        logging.info(f"正在生成SRT文件: {srt_path}")
        with open(srt_path, 'w', encoding='utf-8') as f:
            # 遍历每一句识别结果
            for i, sentence in enumerate(result_detail):
                start_time = format_time(sentence.StartMs) # 获取开始时间
                end_time = format_time(sentence.EndMs)     # 获取结束时间
                text = sentence.FinalSentence              # 获取识别文本
                # 删除文本中的逗号和句号
                text = text.replace('，', '').replace('。', '').replace(',', '').replace('.', '')

                # 写入SRT格式内容
                f.write(f"{i + 1}\n")
                f.write(f"{start_time} --> {end_time}\n")
                f.write(f"{text}\n\n")
        logging.info(f"SRT文件 {srt_path} 生成成功。")
    except Exception as e:
        logging.error(f"生成SRT文件失败: {e}")


def delete_from_cos(file_name):
    """从腾讯云COS中删除一个文件。"""
    try:
        logging.info(f"准备从COS删除文件: {file_name}...")
        # 初始化COS客户端
        cos_config = CosConfig(Region=REGION, SecretId=SECRET_ID, SecretKey=SECRET_KEY)
        cos_client = CosS3Client(cos_config)

        cos_client.delete_object(
            Bucket=BUCKET,
            Key=file_name
        )
        logging.info(f"文件 {file_name} 已从COS成功删除。")
    except Exception as e:
        logging.error(f"从COS删除文件 {file_name} 失败: {e}")


class AudioFileHandler(FileSystemEventHandler):
    """处理新音频文件的文件系统事件。"""
    def on_created(self, event):
        # 当有新文件被创建时，此方法会被调用
        if not event.is_directory and event.src_path.endswith(AUDIO_FORMATS):
            logging.info(f"检测到新的音频文件: {event.src_path}")

            # 等待2秒，确保文件已完全写入磁盘
            time.sleep(2)

            file_url = None
            task_id = None
            file_name = os.path.basename(event.src_path)

            try:
                # 步骤1: 上传到COS
                file_url = upload_to_cos(event.src_path)
                if not file_url:
                    return

                # 步骤2: 创建ASR任务
                task_id = create_asr_task(file_url)
                if not task_id:
                    return

                # 步骤3: 轮询ASR结果
                result_detail = poll_asr_task(task_id)
                if not result_detail:
                    return

                # 步骤4: 生成SRT文件
                srt_path = os.path.splitext(event.src_path)[0] + '.srt'
                generate_srt(result_detail, srt_path)

            finally:
                # 步骤5: 从COS删除音频文件
                # 无论成功与否，都尝试清理COS上的文件
                if file_url:
                    delete_from_cos(file_name)


def main():
    """主函数，用于启动文件监控。"""
    # 检查监控目录是否存在，如果不存在则创建
    if not os.path.exists(WATCH_PATH):
        os.makedirs(WATCH_PATH)
        logging.info(f"已创建监控目录: {WATCH_PATH}")

    logging.info(f"开始监控文件夹: {WATCH_PATH}")
    event_handler = AudioFileHandler()
    observer = Observer()
    # recursive=False 表示不监控子目录
    observer.schedule(event_handler, WATCH_PATH, recursive=False)
    observer.start()

    try:
        # 保持主线程运行，以便持续监控
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        # 用户按下 Ctrl+C 时停止监控
        observer.stop()
    observer.join()
    logging.info("监控已停止。")


if __name__ == "__main__":
    # --- 使用说明 ---
    # 1. 配置 config.ini 文件:
    #    - [TencentCloud] 部分填入你的腾讯云 SecretId, SecretKey, Region (区域) 和 Bucket (COS存储桶名称)。
    #    - [Watch] 部分的 WatchPath 是要监控的文件夹路径，默认是 './watch'。
    #
    # 2. 安装依赖库:
    #    在终端或命令行中运行: pip install tencentcloud-sdk-python watchdog cos-python-sdk-v5
    #
    # 3. 运行脚本:
    #    在终端或命令行中运行: python audio-text.py
    #
    # 4. 使用:
    #    - 脚本运行后，将支持的音频文件（如 .mp3, .wav）放入 `watch` 文件夹。
    #    - 脚本会自动检测到新文件，上传到COS，进行语音识别，并最终在 `watch` 文件夹中生成同名的 .srt 字幕文件。
    #    - 字幕生成后，上传到COS的音频文件会被自动删除，以节省空间。
    main()
