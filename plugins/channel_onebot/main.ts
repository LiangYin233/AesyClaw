/**
 * OneBot 渠道适配器
 * 
 * 基于 NapCat OneBot 11 协议，支持 WebSocket 连接。
 * 
 * 配置选项（config.toml）：
 * - wsUrl: WebSocket 连接地址（例：ws://127.0.0.1:3001）
 * - token: 认证令牌（可选）
 * - friendAllowFrom: 允许接收私聊的用户 ID 列表（空数组表示允许所有）
 * - groupAllowFrom: 允许接收消息的群 ID 列表（空数组表示允许所有）
 * - enabled: 是否启用（默认 true）
 */

import { WebSocket } from 'ws';
import { BaseChannelAdapter, BaseAdapterOptions } from '../../src/features/extension/channel/adapter/BaseChannelAdapter.js';
import { UnifiedMessage, createInboundMessage } from '../../src/features/extension/channel/protocol/unified-message.js';
import { SendResult } from '../../src/features/extension/channel/protocol/adapter-interface.js';
import { ImageAttachment, FileAttachment } from '../../src/features/extension/channel/protocol/attachment.js';
import { logger } from '../../src/platform/observability/index.js';

interface OneBotConfig {
  wsUrl: string;
  token?: string;
  friendAllowFrom?: string[];
  groupAllowFrom?: string[];
}

interface OneBotMessageSegment {
  type: string;
  data: Record<string, unknown>;
}

interface OneBotEvent {
  post_type: string;
  message_type?: 'private' | 'group' | 'discuss';
  message_id: number;
  user_id: number;
  group_id?: number;
  discuss_id?: number;
  message: string | OneBotMessageSegment[];
  raw_message?: string;
  font: number;
  sender: {
    user_id: number;
    nickname?: string;
    card?: string;
    role?: string;
    age?: number;
    area?: string;
    level?: string;
    sex?: string;
    title?: string;
  };
  sub_type?: string;
  time: number;
}

interface OneBotApiResponse {
  status: 'ok' | 'failed';
  retcode: number;
  data: unknown;
  echo?: string;
}

interface OneBotOutgoingPayload {
  action: string;
  params: Record<string, unknown>;
  echo?: string;
}

class OneBotChannelAdapter extends BaseChannelAdapter {
  readonly name = 'onebot';
  
  private ws?: WebSocket;
  private config?: OneBotConfig;
  private reconnectTimer?: NodeJS.Timeout;
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts = 10;
  private readonly baseReconnectDelay = 1000;
  private pendingRequests = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  private messageIdCounter = 0;
  private log = logger.child('OneBot');

  constructor(options?: Partial<BaseAdapterOptions>) {
    super(options);
  }

  protected async onStart(): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.log.warn('Adapter already started, skipping');
      return;
    }
    
    const ctx = (this as unknown as { context?: { config?: OneBotConfig } }).context;
    this.config = ctx?.config || { wsUrl: '' };
    
    if (!this.config.wsUrl) {
      throw new Error('OneBot WebSocket URL not configured');
    }
    
    await this.connect();
  }

  protected async onStop(): Promise<void> {
    this.clearReconnectTimer();
    this.pendingRequests.forEach(({ reject }) => reject(new Error('Connection closed')));
    this.pendingRequests.clear();
    
    if (this.ws) {
      this.ws.removeAllListeners();
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.close(1000, 'Adapter stopped');
      }
      this.ws = undefined;
    }
  }

  protected async parsePlatformEvent(rawEvent: unknown): Promise<UnifiedMessage | null> {
    const event = rawEvent as OneBotEvent;
    
    if (event.post_type !== 'message') {
      return null;
    }

    const messageType = event.message_type;
    if (!messageType || (messageType !== 'private' && messageType !== 'group')) {
      return null;
    }

    const isPrivate = messageType === 'private';
    const sourceId = isPrivate ? event.user_id.toString() : event.group_id?.toString();
    
    if (!sourceId) {
      return null;
    }

    if (!this.isSourceAllowed(isPrivate, sourceId)) {
      return null;
    }

    const sender = event.sender || { user_id: event.user_id };
    const senderName = sender.nickname || sender.card || `User_${event.user_id}`;
    const chatTitle = isPrivate ? senderName : `Group_${event.group_id}`;

    const messageContent = Array.isArray(event.message) 
      ? this.parseMessageChain(event.message)
      : event.message;

    const images = await this.extractImagesFromEvent(event.message);
    const files = await this.extractFilesFromEvent(event.message, event);
    const mentions = this.extractMentionIds(event.message);
    
    let replyTo: string | undefined;
    let replyToText: string | undefined;
    let replyImages: ImageAttachment[] = [];
    let replyFiles: FileAttachment[] = [];
    
    if (Array.isArray(event.message)) {
      const replySeg = event.message.find(seg => seg.type === 'reply');
      if (replySeg) {
        const replyData = replySeg.data as { id?: number | string; text?: string;qq?: string | number};
        if (replyData?.id) {
          const replyId = typeof replyData.id === 'number' ? replyData.id.toString() : replyData.id.toString();
          replyTo = `onebot_${replyId}`;
          replyToText = replyData.text as string | undefined;
          
          try {
            this.log.debug('获取引用消息', { replyId });
            const msgResult = await this.callApi('get_msg', { message_id: parseInt(replyId, 10) }) as Record<string, unknown>;
            
            if (msgResult.status !== 'ok') {
              throw new Error(`get_msg API调用失败: retcode=${msgResult.retcode}`);
            }
            
            this.log.debug('引用消息响应', { result: JSON.stringify(msgResult).substring(0, 500) });
            
            const message = msgResult['message'];
            
            if (Array.isArray(message)) {
              const originalImages = await this.extractImagesFromEvent(message);
              const originalFiles = await this.extractFilesFromEvent(message, msgResult as unknown as OneBotEvent);
              const originalText = this.parseMessageChain(message);
              
              if (!replyToText && originalText) {
                replyToText = originalText;
              }
              if (originalImages.length > 0) {
                replyImages = originalImages;
                this.log.debug('引用消息有图片', { count: originalImages.length });
              }
              if (originalFiles.length > 0) {
                replyFiles = originalFiles;
                this.log.debug('引用消息有文件', { count: originalFiles.length });
              }
            } else if (!replyToText && typeof message === 'string') {
              replyToText = message;
            } else if (!replyToText && msgResult['raw_message']) {
              replyToText = msgResult['raw_message'] as string;
            } else {
              this.log.debug('引用消息未获取到内容', { replyId });
            }
          } catch (error) {
            this.log.warn('获取引用消息失败', { error: error instanceof Error ? error.message : String(error) });
          }
        }
      }
    }

    if (Array.isArray(event.message) && event.message.length === 0) {
      return null;
    }

    return createInboundMessage({
      id: this.generateMessageId(event.message_id),
      channel: 'onebot',
      chatId: sourceId,
      chatType: isPrivate ? 'private' : 'group',
      chatTitle,
      senderId: event.user_id.toString(),
      senderName,
      text: messageContent,
      images,
      files,
      timestamp: new Date(event.time * 1000),
      raw: event,
      replyTo,
      replyToText,
      replyImages,
      replyFiles,
      metadata: {
        mentions,
        subType: event.sub_type,
        messageId: event.message_id,
        groupId: event.group_id,
        userId: event.user_id
      }
    });
  }

  protected async sendToPlatform(message: UnifiedMessage): Promise<SendResult> {
    try {
      const isGroup = message.chatType === 'group';
      const targetId = message.chatId;
      
      const hasImages = (message.images && message.images.length > 0);
      const hasFiles = (message.files && message.files.length > 0);
      
      if (hasImages || hasFiles) {
        let lastMessageId: string | undefined;
        
        if (message.text) {
          const textSeg = [{ type: 'text' as const, data: { text: message.text } }];
          lastMessageId = await this.sendOneBotMessage(isGroup, targetId, textSeg);
        }
        
        for (const image of message.images || []) {
          const filePath = await this.uploadFileStream(image.url, image.name || 'image.png');
          if (filePath) {
            const seg = [{ type: 'image' as const, data: { file: filePath } }];
            const msgId = await this.sendOneBotMessage(isGroup, targetId, seg);
            if (msgId) lastMessageId = msgId;
          }
        }
        
        for (const file of message.files || []) {
          const fileMessageId = await this.uploadAndSendFile(isGroup, targetId, file);
          if (fileMessageId) lastMessageId = fileMessageId;
        }
        
        return {
          success: true,
          messageId: lastMessageId
        };
      }
      
      const obMessage = await this.buildOneBotMessage(message);
      const messageId = await this.sendOneBotMessage(isGroup, targetId, obMessage);
      
      return { success: true, messageId };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { success: false, error: errorMessage };
    }
  }
  
  private async sendOneBotMessage(isGroup: boolean, targetId: string, obMessage: (string | OneBotMessageSegment)[]): Promise<string | undefined> {
    const payload: Record<string, unknown> = {
      message: obMessage
    };

    if (isGroup) {
      payload.group_id = targetId;
    } else {
      payload.user_id = targetId;
    }

    const response = await this.callApi(
      isGroup ? 'send_group_msg' : 'send_private_msg',
      payload
    ) as { message_id: number };

    if (response && typeof response === 'object' && 'message_id' in response) {
      return response.message_id.toString();
    }
    return undefined;
  }
  
  private async uploadAndSendFile(isGroup: boolean, targetId: string, file: { url: string; name?: string; type?: string }): Promise<string | undefined> {
    try {
      const fileName = file.name || this.generateFileName(file.url);
      
      let fileType = 'file';
      if (file.type === 'image') fileType = 'image';
      else if (file.type === 'audio') fileType = 'record';
      else if (file.type === 'video') fileType = 'video';
      
      const filePath = await this.uploadFileStream(file.url, fileName);
      
      if (!filePath) {
        this.log.error('Stream API 上传失败，无法发送文件');
        return undefined;
      }
      
      const obMessage = [{ type: fileType, data: { file: filePath } }];
      return await this.sendOneBotMessage(isGroup, targetId, obMessage);
    } catch (error) {
      this.log.error('发送文件失败', { error: error instanceof Error ? error.message : String(error), file: file.url });
      return undefined;
    }
  }
  
  private generateStreamId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
  }
  
  private async calculateSha256(data: Uint8Array): Promise<string> {
    const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }
  
  private async readFileContent(filePath: string): Promise<Uint8Array> {
    try {
      const response = await fetch(filePath);
      if (response.ok) {
        return new Uint8Array(await response.arrayBuffer());
      }
    } catch {
    }
    
    const { readFile } = await import('fs/promises');
    const buffer = await readFile(filePath);
    return new Uint8Array(buffer);
  }
  
  private async uploadFileStream(fileUrl: string, fileName: string): Promise<string | undefined> {
    try {
      let fileContent: Uint8Array;
      
      if (fileUrl.startsWith('http://') || fileUrl.startsWith('https://')) {
        const response = await fetch(fileUrl);
        if (!response.ok) {
          throw new Error(`下载文件失败: ${response.status}`);
        }
        fileContent = new Uint8Array(await response.arrayBuffer());
      } else {
        fileContent = await this.readFileContent(fileUrl);
      }
      
      const fileSize = fileContent.length;
      const sha256Hash = await this.calculateSha256(fileContent);
      
      const justFileName = fileName.split(/[/\\]/).pop() || fileName;
      this.log.debug('Stream API 开始上传文件', { fileName: justFileName, fileSize, sha256: sha256Hash.substring(0, 16) + '...' });
      
      const streamId = this.generateStreamId();
      const chunkSize = 64 * 1024;
      const totalChunks = Math.ceil(fileSize / chunkSize);
      
      for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
        const start = chunkIndex * chunkSize;
        const end = Math.min(start + chunkSize, fileSize);
        const chunkData = fileContent.slice(start, end);
        const chunkBase64 = Buffer.from(chunkData).toString('base64');
        
        const params = {
          stream_id: streamId,
          chunk_data: chunkBase64,
          chunk_index: chunkIndex,
          total_chunks: totalChunks,
          file_size: fileSize,
          expected_sha256: sha256Hash,
          filename: justFileName,
          file_retention: 30 * 1000
        };
        
        const result = await this.callApi('upload_file_stream', params);
        
        if (!result || typeof result !== 'object') {
          throw new Error('Stream API 响应无效');
        }
        
        const data = result as { status?: string; data?: { received_chunks?: number; total_chunks?: number } };
        this.log.debug(`分片 ${chunkIndex + 1}/${totalChunks} 上传成功`);
      }
      
      const completeResult = await this.callApi('upload_file_stream', {
        stream_id: streamId,
        is_complete: true
      });
      
      if (!completeResult || typeof completeResult !== 'object') {
        throw new Error('文件合并响应无效');
      }
      
      const responseData = completeResult as {
        data?: Record<string, unknown>;
        file_path?: string;
      };
      
      const filePath = responseData.file_path 
        || (responseData.data as { file_path?: string })?.file_path
        || (responseData.data as { file_path_1?: string })?.file_path_1
        || (responseData.data as { file_path_2?: string })?.file_path_2
        || (responseData.data as { temp_file?: string })?.temp_file
        || (responseData.data as { local_file?: string })?.local_file;
      
      if (filePath) {
        return filePath;
      }
      
      this.log.warn('文件上传完成但未返回路径');
      return undefined;
    } catch (error) {
      this.log.error('Stream API 上传失败', { error: error instanceof Error ? error.message : String(error) });
      return undefined;
    }
  }
  
  private generateFileName(url: string): string {
    try {
      const parsed = new URL(url);
      const pathParts = parsed.pathname.split('/');
      return pathParts[pathParts.length - 1] || 'file';
    } catch {
      return 'file';
    }
  }

  private async connect(): Promise<void> {
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws = undefined;
    }
    
    return new Promise((resolve, reject) => {
      const headers: Record<string, string> = {};
      if (this.config?.token) {
        headers['Authorization'] = `Bearer ${this.config.token}`;
      }

      this.ws = new WebSocket(this.config!.wsUrl, { headers });

      this.ws.on('open', () => {
        this.log.info('WebSocket connected');
        this.reconnectAttempts = 0;
        resolve();
      });

      this.ws.on('message', async (data) => {
        try {
          const payload = JSON.parse(data.toString());
          await this.handlePayload(payload);
        } catch (error) {
          this.log.error('Failed to parse message', { error: error instanceof Error ? error.message : String(error) });
        }
      });

      this.ws.on('close', (code, reason) => {
        const isNormalClose = code === 1000;
        if (isNormalClose) {
          this.log.debug('WebSocket closed', { code });
        } else {
          this.log.warn('WebSocket disconnected', { code, reason: reason.toString() });
        }
        this.scheduleReconnect();
      });

      this.ws.on('error', (error) => {
        this.log.error('WebSocket error', { error: error.message });
        if (this.ws?.readyState !== WebSocket.OPEN) {
          reject(error);
        }
      });
    });
  }

  private async handlePayload(payload: OneBotEvent | OneBotApiResponse): Promise<void> {
    if ('echo' in payload && payload.echo) {
      const pending = this.pendingRequests.get(payload.echo);
      if (pending) {
        this.pendingRequests.delete(payload.echo);
        if (payload.status === 'ok') {
          pending.resolve(payload.data);
        } else {
          pending.reject(new Error(`API error: ${payload.retcode}`));
        }
      }
      return;
    }

    if ('post_type' in payload) {
      const self = this as unknown as { context?: { reportIncoming: (msg: UnifiedMessage) => Promise<void> }; parseEvent: (evt: unknown) => Promise<UnifiedMessage | null> };
      if (self.context) {
        const message = await self.parseEvent(payload);
        if (message) {
          await self.context.reportIncoming(message);
        }
      }
    }
  }

  private async callApi(action: string, params: Record<string, unknown>): Promise<unknown> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket not connected');
    }

    const echo = `req_${++this.messageIdCounter}_${Date.now()}`;
    
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(echo);
        reject(new Error(`API call timeout: ${action}`));
      }, 30000);

      this.pendingRequests.set(echo, {
        resolve: (value) => {
          clearTimeout(timeout);
          this.log.debug('OneBot API 响应', { action, echo, response: JSON.stringify(value).substring(0, 500) });
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        }
      });

      const outgoing: OneBotOutgoingPayload = { action, params, echo };
      this.ws!.send(JSON.stringify(outgoing));
    });
  }

  private async buildOneBotMessage(message: UnifiedMessage): Promise<(string | OneBotMessageSegment)[]> {
    const segments: (string | OneBotMessageSegment)[] = [];

    if (message.text) {
      segments.push({ type: 'text', data: { text: message.text } });
    }

    for (const image of message.images || []) {
      segments.push({ type: 'image', data: { file: image.url } });
    }

    for (const file of message.files || []) {
      if (file.type === 'audio') {
        segments.push({ type: 'record', data: { file: file.url } });
      } else if (file.type === 'video') {
        segments.push({ type: 'video', data: { file: file.url } });
      } else {
        segments.push({ type: 'file', data: { file: file.url, name: file.name } });
      }
    }

    return segments;
  }

  private parseMessageChain(segments: OneBotMessageSegment[]): string {
    return segments
      .filter(seg => seg.type === 'text' || seg.type === 'plain')
      .map(seg => {
        const data = seg.data as Record<string, string>;
        return data.text || data.content || '';
      })
      .join('');
  }

  private async extractImagesFromEvent(message: string | OneBotMessageSegment[]): Promise<ImageAttachment[]> {
    const images: ImageAttachment[] = [];
    
    if (!Array.isArray(message)) return images;

    for (const seg of message) {
      if (seg.type === 'image') {
        const data = seg.data as Record<string, unknown>;
        const url = typeof data.url === 'string' ? data.url : '';
        const fileId = typeof data.file_id === 'string' ? data.file_id : '';
        const file = typeof data.file === 'string' ? data.file : '';
        
        const resolvedUrl = url || file || fileId;
        const name = file.split('/').pop() || fileId.split('/').pop() || 'image.png';
        
        if (!resolvedUrl) continue;
        
        images.push({
          id: `img_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          type: 'image',
          name,
          url: resolvedUrl
        });
        
        this.log.debug('解析图片', { url: resolvedUrl, name });
      }
    }
    
    return images;
  }

  private async extractFilesFromEvent(message: string | OneBotMessageSegment[], event: OneBotEvent): Promise<FileAttachment[]> {
    const files: FileAttachment[] = [];
    
    if (!Array.isArray(message)) return files;

    for (const seg of message) {
      if (seg.type === 'record' || seg.type === 'video' || seg.type === 'file') {
        const data = seg.data as Record<string, unknown>;
        const fileId = typeof data.file_id === 'string' ? data.file_id : '';
        const filePath = typeof data.file === 'string' ? data.file : '';
        const name = typeof data.name === 'string' ? data.name : filePath.split('/').pop() || fileId.split('/').pop() || 'file';
        
        let type: 'file' | 'audio' | 'video' = 'file';
        if (seg.type === 'record') type = 'audio';
        else if (seg.type === 'video') type = 'video';
        
        let url = filePath;
        
        if (seg.type === 'record' && filePath) {
          try {
            url = await this.downloadVoice(filePath, name);
          } catch (error) {
            this.log.warn('下载语音失败，使用原始路径', { filePath, error: error instanceof Error ? error.message : String(error) });
          }
        } else if (fileId) {
          try {
            url = await this.downloadFile(fileId, name, event);
          } catch (error) {
            this.log.warn('下载文件失败，使用原始 URL', { fileId, error: error instanceof Error ? error.message : String(error) });
          }
        }
        
        files.push({
          id: `file_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          type,
          name,
          url
        });
      }
    }
    
    return files;
  }
  
  private async downloadVoice(filePath: string, fileName: string): Promise<string> {
    this.log.debug('========== 语音下载开始 ==========', { filePath, fileName });
    
    const justFileName = fileName.split(/[/\\]/).pop() || fileName;
    const outputName = justFileName.replace(/\.[^.]+$/, '.mp3');
    
    try {
      this.log.debug('发送 download_file_record_stream 请求', { file: filePath, out_format: 'mp3' });
      
      const result = await this.callApi('download_file_record_stream', {
        file: filePath,
        out_format: 'mp3',
        chunk_size: 65536
      }) as Record<string, unknown>;
      
      console.log('========== download_file_record_stream 完整响应 ==========');
      console.log(JSON.stringify(result, null, 2));
      console.log('=======================================================');
      
      if (!result || typeof result !== 'object') {
        throw new Error('响应无效: ' + JSON.stringify(result));
      }
      
      const dataObj = result.data as Record<string, unknown> | undefined;
      const dataType = result.data_type as string | undefined;
      
      if (dataType === 'file_info') {
        const file = result.file as string | undefined;
        const fileUrl = result.url as string | undefined;
        
        this.log.debug('file_info 详情', { file, fileUrl, resultKeys: Object.keys(result) });
        
        if (fileUrl && fileUrl.startsWith('http')) {
          this.log.debug('获取到 URL，下载文件', { fileUrl });
          const response = await fetch(fileUrl);
          if (!response.ok) {
            throw new Error(`下载失败: ${response.status}`);
          }
          const buffer = Buffer.from(await response.arrayBuffer());
          const savedPath = await this.saveToChannelAssets(outputName, buffer);
          this.log.debug('========== 语音下载成功 (URL) ==========', { 
            filePath, 
            savedPath, 
            size: buffer.length 
          });
          return savedPath;
        }
        
        if (dataObj?.file && typeof dataObj.file === 'string') {
          const tempFile = dataObj.file as string;
          this.log.debug('从 data.file 获取临时路径', { tempFile });
          
          if (tempFile.startsWith('http')) {
            const response = await fetch(tempFile);
            if (!response.ok) {
              throw new Error(`下载失败: ${response.status}`);
            }
            const buffer = Buffer.from(await response.arrayBuffer());
            const savedPath = await this.saveToChannelAssets(outputName, buffer);
            return savedPath;
          }
        }
      }
      
      const file = result.file as string | undefined;
      const fileUrl = result.url as string | undefined;
      const status = result.status as string | undefined;
      const retcode = result.retcode as number | undefined;
      
      this.log.debug('响应解析结果', { status, retcode, file, fileUrl, hasData: !!dataObj, dataKeys: dataObj ? Object.keys(dataObj) : [] });
      
      if (status === 'ok' && dataObj?.file) {
        const tempFile = dataObj.file as string;
        this.log.debug('获取到临时文件路径', { tempFile });
        
        if (tempFile.startsWith('http')) {
          const response = await fetch(tempFile);
          if (!response.ok) {
            throw new Error(`下载失败: ${response.status}`);
          }
          const buffer = Buffer.from(await response.arrayBuffer());
          const savedPath = await this.saveToChannelAssets(outputName, buffer);
          this.log.debug('========== 语音下载成功 ==========', { 
            filePath, 
            savedPath, 
            size: buffer.length 
          });
          return savedPath;
        }
      }
      
      this.log.debug('无法获取有效文件路径，保留原始路径');
      return filePath;
      
    } catch (error) {
      this.log.error('========== 语音下载失败 ==========', { 
        filePath, 
        error: error instanceof Error ? error.message : String(error)
      });
      return filePath;
    }
  }

  private async downloadFile(fileId: string, fileName: string, event: OneBotEvent): Promise<string> {
    const isGroup = event.message_type === 'group';
    
    this.log.debug('获取文件直链', { fileId, fileName, isGroup });
    
    const urlParams: Record<string, unknown> = { file_id: fileId };
    if (isGroup && event.group_id) {
      urlParams.group_id = event.group_id;
    }
    
    const action = isGroup ? 'get_group_file_url' : 'get_private_file_url';
    const urlResult = await this.callApi(action, urlParams);
    
    this.log.debug('直链响应原始', { fileId, result: JSON.stringify(urlResult) });
    
    let fileUrl: string | undefined;
    if (urlResult && typeof urlResult === 'object') {
      const result = urlResult as Record<string, unknown>;
      fileUrl = result.url as string | undefined;
    }
    
    if (fileUrl) {
      this.log.debug('获取到直链，下载文件', { fileId, urlLength: fileUrl.length });
      
      const response = await fetch(fileUrl);
      if (!response.ok) {
        throw new Error(`下载失败: ${response.status}`);
      }
      
      const buffer = Buffer.from(await response.arrayBuffer());
      const filePath = await this.saveToChannelAssets(fileName, buffer);
      this.log.debug('文件已下载 (HTTP)', { fileId, filePath, size: buffer.length });
      return filePath;
    }
    
    throw new Error('获取文件直链失败');
  }
  
  private async saveToChannelAssets(fileName: string, buffer: Buffer): Promise<string> {
    const { join } = await import('path');
    const { writeFile, mkdir, access, constants } = await import('fs/promises');
    
    const assetsDir = join(process.cwd(), '.aesyclaw', 'channel-assets', 'onebot');
    await mkdir(assetsDir, { recursive: true });
    
    const uniqueName = `${Date.now()}_${Math.random().toString(36).substring(2, 7)}_${fileName}`;
    const filePath = join(assetsDir, uniqueName);
    
    await writeFile(filePath, buffer);
    return filePath;
  }

  private extractMentionIds(message: string | OneBotMessageSegment[]): string[] {
    const mentions: string[] = [];
    
    if (!Array.isArray(message)) return mentions;
    
    for (const seg of message) {
      if (seg.type === 'at') {
        const data = seg.data as Record<string, unknown>;
        if (data.qq && typeof data.qq === 'string') {
          mentions.push(data.qq);
        } else if (data.user_id) {
          mentions.push(String(data.user_id));
        }
      }
    }
    
    return mentions;
  }

  private isSourceAllowed(isPrivate: boolean, sourceId: string): boolean {
    if (!this.config) return true;
    
    if (isPrivate) {
      const allowList = this.config.friendAllowFrom;
      if (!allowList || allowList.length === 0) return true;
      return allowList.includes(sourceId);
    } else {
      const allowList = this.config.groupAllowFrom;
      if (!allowList || allowList.length === 0) return true;
      return allowList.includes(sourceId);
    }
  }

  private generateMessageId(platformId: number): string {
    return `onebot_${platformId}_${Date.now()}`;
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.log.error('Max reconnect attempts reached, giving up');
      return;
    }

    const delay = Math.min(
      this.baseReconnectDelay * Math.pow(2, this.reconnectAttempts),
      30000
    );

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectAttempts++;
      try {
        await this.connect();
      } catch (error) {
        this.log.warn('Reconnect failed', { error: error instanceof Error ? error.message : String(error) });
      }
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
  }
}

const adapter = new OneBotChannelAdapter();

export default adapter;
