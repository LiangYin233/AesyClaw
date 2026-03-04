import { spawn } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { randomUUID } from 'crypto';

const MD_PATTERN = /(^```[\s\S]*?\n```$)|(^\$\$[\s\S]*?\$\$$)|(\$(?:\\.|[^\n$])+\$)|(^#{1-6}\s+\S.+$)|(^>\s+\S.+$)|(^\s{0,3}[-*+]\s+\S.+$)|(^\s{0,3}\d+\.\s+\S.+$)|(^\|[^\n]*\|[^\n]*$)|(!\[[^\]]*\]\([^)]+\)|\[[^\]]+\]\([^)]+\))|(^\s{0,3}(?:-{3,}|_{3,}|\*{3,})\s*$)/m;

let log = console;

const plugin = {
  name: 'md2img',
  version: '1.0.0',
  description: '将 Markdown 自动转换为图片',
  defaultConfig: {
    enabled: false,
    options: {
      minLength: 50,
      verboseLog: false,
      scale: 1.0
    }
  },

  config: {
    minLength: 50,
    verboseLog: false,
    scale: 1.0
  },

  async onLoad(context) {
    if (context.logger) {
      log = context.logger.child({ prefix: 'md2img' });
    }
    
    const options = context.options || {};
    this.config = {
      minLength: options?.minLength ?? 50,
      verboseLog: options?.verboseLog ?? false,
      scale: Math.max(0.5, Math.min(3.0, options?.scale ?? 1.0))
    };
    
    if (this.config.verboseLog) {
      log.info('Plugin loaded with config:', this.config);
    }
  },

  async onResponse(msg) {
    if (!msg.content || msg.content.length < this.config.minLength) {
      return msg;
    }

    if (!this.isMarkdown(msg.content)) {
      return msg;
    }

    try {
      let markdownContent = msg.content;

      if (msg.reasoning_content) {
        const thinkingBlock = `\n\n> ${msg.reasoning_content.replace(/\n/g, '\n> ')}\n`;
        markdownContent = thinkingBlock + markdownContent;
        if (this.config.verboseLog) {
          log.info(`Added thinking block: ${msg.reasoning_content.length} chars`);
        }
      }

      if (this.config.verboseLog) {
        log.info(`Converting markdown: ${markdownContent.length} chars`);
      }

      const imagePath = await this.renderToImage(markdownContent);
      
      msg.media = msg.media || [];
      msg.media.push(imagePath);
      
      msg.content = '';

      if (this.config.verboseLog) {
        log.info('Markdown converted successfully:', imagePath);
      }
    } catch (error) {
      log.error('Conversion failed:', error);
    }

    return msg;
  },

  isMarkdown(text) {
    return MD_PATTERN.test(text);
  },

  async renderToImage(text) {
    const tmpdir = os.tmpdir();
    const mdFile = path.join(tmpdir, `md2img_${randomUUID()}.md`);
    const outputFile = path.join(tmpdir, `md2img_${randomUUID()}.png`);
    
    try {
      await fs.writeFile(mdFile, text, 'utf-8');
      
      await this.runRenderScript(mdFile, outputFile);
      
      await fs.unlink(mdFile);
      
      return outputFile;
    } catch (error) {
      try {
        await fs.unlink(mdFile);
      } catch {}
      throw error;
    }
  },

  runRenderScript(mdFile, outputFile) {
    return new Promise((resolve, reject) => {
      const url = new URL(import.meta.url);
      let pluginDir = url.pathname.replace(/^\/([A-Za-z]:)\//, '$1:/');
      pluginDir = path.dirname(pluginDir);
      const renderScript = path.join(pluginDir, 'render.js');
      
      log.debug('Plugin dir:', pluginDir, 'Render script:', renderScript);
      
      const child = spawn('node', [renderScript, mdFile, outputFile, this.config.scale.toString()], {
        stdio: 'pipe'
      });

      let stderr = '';
      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(stderr || `Render script failed with code ${code}`));
        } else {
          resolve();
        }
      });

      child.on('error', reject);
    });
  }
};

export default plugin;
