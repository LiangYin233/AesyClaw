import {
  Client,
  GatewayIntentBits,
  Events,
  Partials,
  Message as DiscordMessage,
  TextChannel,
  DMChannel,
  ThreadChannel,
  REST,
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  Routes
} from 'discord.js';
import { BaseChannelAdapter } from '../../src/features/extension/channel/adapter/BaseChannelAdapter.js';
import type { SendResult } from '../../src/features/extension/channel/protocol/adapter-interface.js';
import type { UnifiedMessage } from '../../src/features/extension/channel/protocol/unified-message.js';
import type { ImageAttachment, FileAttachment } from '../../src/features/extension/channel/protocol/attachment.js';
import { logger } from '../../src/platform/observability/index.ts';

interface DiscordConfig {
  botToken: string;
  autoRegisterSlashCommands: boolean;
  friendAllowFrom?: string[];
  groupAllowFrom?: string[];
}

export const defaultChannelConfig: DiscordConfig = {
  botToken: '',
  autoRegisterSlashCommands: false,
  friendAllowFrom: [],
  groupAllowFrom: []
};

class DiscordAdapter extends BaseChannelAdapter {
  readonly name = 'discord';
  private client?: Client;
  private rest?: REST;
  private running = false;
  private log = logger.child('Discord');
  private config: DiscordConfig = { ...defaultChannelConfig };

  constructor() {
    super();
  }

  protected async onStart(): Promise<void> {
    const channelConfig = this.context?.config as unknown as Partial<DiscordConfig> | undefined;
    if (channelConfig) {
      this.config = { ...defaultChannelConfig, ...channelConfig };
    }

    if (!this.config.botToken || this.config.botToken.trim() === '') {
      throw new Error('Discord bot token is not configured. Please set channel.discord.botToken in config.toml');
    }

    this.log.info('Starting Discord bot...');

    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.MessageContent
      ],
      partials: [Partials.Channel, Partials.Message]
    });

    this.rest = new REST({ version: '10' }).setToken(this.config.botToken);

    this.setupEventHandlers();

    try {
      this.log.info('Connecting to Discord...');
      await this.client.login(this.config.botToken);
      this.log.info('Discord client.login() succeeded');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.log.error(`Discord login failed: ${errorMessage}`);

      if (errorMessage.toLowerCase().includes('token') || errorMessage.includes('401')) {
        throw new Error(`Discord bot token is invalid or expired. Please reset the token in Discord Developer Portal and update config.toml. Error: ${errorMessage}`);
      }
      throw new Error(`Failed to connect to Discord: ${errorMessage}`);
    }

    if (this.client.user) {
      this.log.info(`Discord bot logged in as ${this.client.user.tag}`);
    } else {
      this.log.warn('Discord bot connected but user info not available');
    }

    if (this.config.autoRegisterSlashCommands) {
      try {
        await this.registerSlashCommands();
      } catch (error) {
        this.log.warn('Failed to register slash commands, but bot will continue to work: ' + (error instanceof Error ? error.message : String(error)));
      }
    }

    this.running = true;
    this.log.info('Discord bot started successfully');
  }

  protected async onStop(): Promise<void> {
    this.running = false;
    if (this.client) {
      this.client.destroy();
      this.client = undefined;
    }
    this.log.info('Discord bot stopped');
  }

  protected async parsePlatformEvent(rawEvent: unknown): Promise<UnifiedMessage | null> {
    const message = rawEvent as DiscordMessage;

    if (this.shouldIgnoreMessage(message)) {
      return null;
    }

    const isDM = message.channel.type === 1;
    const conversation = {
      id: message.channel.id,
      type: isDM ? 'private' as const : 'group' as const
    };

    const sender = {
      id: message.author.id,
      senderName: message.author.username,
      isSelf: false
    };

    const { text, images, files } = await this.parseMessageContent(message);

    return {
      id: message.id,
      channel: 'discord',
      direction: 'inbound',
      chatId: conversation.id,
      chatType: conversation.type,
      senderId: sender.id,
      senderName: sender.senderName,
      isSelf: false,
      text,
      images,
      files,
      timestamp: message.createdAt,
      raw: message
    };
  }

  protected async sendToPlatform(message: UnifiedMessage): Promise<SendResult> {
    if (!this.client) {
      throw new Error('Discord client not initialized');
    }

    const channel = await this.client.channels.fetch(message.chatId);
    if (!channel || (!('send' in channel) && !('sendMessage' in channel))) {
      throw new Error(`Channel ${message.chatId} not found or not text-based`);
    }

    const textChannel = channel as TextChannel | DMChannel | ThreadChannel;

    // 构建发送内容
    let textContent = message.text || '';
    const files: string[] = [];

    // 处理图片和文件
    for (const image of message.images) {
      if (image.url) {
        files.push(image.url);
      }
    }

    for (const file of message.files) {
      if (file.url) {
        files.push(file.url);
      }
    }

    // Discord 消息长度限制
    if (textContent.length > 2000) {
      textContent = textContent.substring(0, 1997) + '...';
    }

    try {
      const sendOptions: { content?: string; files?: string[] } = {};
      if (textContent) sendOptions.content = textContent;
      if (files.length > 0) sendOptions.files = files;

      const sentMessage = await textChannel.send(sendOptions);

      return {
        success: true,
        messageId: sentMessage.id
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  private shouldIgnoreMessage(message: DiscordMessage): boolean {
    if (!message.author || message.author.bot) return true;

    const senderId = message.author.id;
    const isDM = message.channel.type === 1;

    if (isDM) {
      if (this.config.friendAllowFrom && this.config.friendAllowFrom.length > 0) {
        if (!this.config.friendAllowFrom.includes(senderId)) return true;
      }
    } else {
      if (this.config.groupAllowFrom && this.config.groupAllowFrom.length > 0) {
        const channelId = message.channel.id;
        if (!this.config.groupAllowFrom.includes(channelId)) return true;
      }
    }

    return false;
  }

  private async parseMessageContent(message: DiscordMessage): Promise<{ text: string; images: ImageAttachment[]; files: FileAttachment[] }> {
    const images: ImageAttachment[] = [];
    const files: FileAttachment[] = [];
    let text = '';

    // 处理引用（回复）
    if (message.reference && message.reference.messageId) {
      text += `[Reply to: ${message.reference.messageId}]\n`;
    }

    // 处理文本和提及
    const content = message.content;
    if (content) {
      // 将 Discord 提及格式转换为可读格式
      text += content.replace(/<@!?(<d+>)/g, '@$1').replace(/<#(<d+>)/g, '#$1');
    }

    // 处理附件
    for (const attachment of message.attachments.values()) {
      if (attachment.contentType?.startsWith('image/')) {
        images.push({
          id: attachment.id,
          type: 'image',
          name: attachment.name || 'image.png',
          url: attachment.url
        });
      } else if (attachment.contentType?.startsWith('audio/')) {
        files.push({
          id: attachment.id,
          type: 'audio',
          name: attachment.name || 'audio.mp3',
          url: attachment.url
        });
      } else if (attachment.contentType?.startsWith('video/')) {
        files.push({
          id: attachment.id,
          type: 'video',
          name: attachment.name || 'video.mp4',
          url: attachment.url
        });
      } else {
        files.push({
          id: attachment.id,
          type: 'file',
          name: attachment.name || 'file',
          url: attachment.url
        });
      }
    }

    return { text, images, files };
  }

  private setupEventHandlers(): void {
    if (!this.client) return;

    this.client.on(Events.MessageCreate, async (message) => {
      if (!message.author || message.author.bot) return;

      if (!this.shouldIgnoreMessage(message)) {
        const unifiedMessage = await this.parsePlatformEvent(message);
        if (unifiedMessage) {
          void (this as any).context?.reportIncoming(unifiedMessage);
        }
      }
    });

    this.client.on(Events.InteractionCreate, async (interaction) => {
      if (!interaction.isChatInputCommand()) return;
      await this.handleSlashCommand(interaction);
    });

    this.client.on(Events.Error, (error) => {
      this.log.error('Discord client error: ' + (error.message || 'Unknown error'));
    });
  }

  private async registerSlashCommands(): Promise<void> {
    if (!this.client || !this.rest) return;

    try {
      this.log.info('Registering slash commands...');

      const commands = [
        new SlashCommandBuilder()
          .setName('ping')
          .setDescription('Check if the bot is alive'),
        new SlashCommandBuilder()
          .setName('help')
          .setDescription('Show available commands and usage information')
      ];

      const guilds = this.client.guilds.cache;

      for (const guild of guilds.values()) {
        try {
          await this.rest.put(
            Routes.applicationGuildCommands(this.client.user!.id, guild.id),
            { body: commands.map(cmd => cmd.toJSON()) }
          );
          this.log.info(`Registered ${commands.length} commands for guild: ${guild.name}`);
        } catch (error) {
          this.log.error(`Failed to register commands for guild ${guild.name}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      this.log.info('Slash commands registered successfully');
    } catch (error) {
      this.log.error('Failed to register slash commands: ' + (error instanceof Error ? error.message : String(error)));
    }
  }

  private async handleSlashCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    const commandName = interaction.commandName;

    if (commandName === 'ping') {
      await interaction.reply('Pong! Bot is online.');
      return;
    }

    if (commandName === 'help') {
      const embed = new EmbedBuilder()
        .setTitle('AesyClaw Discord Bot')
        .setDescription('I am an AI assistant powered by AesyClaw.')
        .addFields(
          { name: 'Commands', value: '`/ping` - Check bot status\n`/help` - Show this help message' },
          { name: 'Usage', value: 'Mention me or send a message in a channel I have access to.' }
        )
        .setColor(0x0099FF);

      await interaction.reply({ embeds: [embed] });
      return;
    }
  }
}

// 导出适配器实例
export default new DiscordAdapter();
