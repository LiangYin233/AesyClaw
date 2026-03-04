import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';
import { marked } from 'marked';
import markedKatex from 'marked-katex-extension';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

marked.use(markedKatex({ throwOnError: false }));
marked.setOptions({ gfm: true, breaks: true });

async function renderMarkdownToImage(markdownText, outputPath, scale = 1.0) {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({
        viewport: { width: 900, height: 10000 },
        deviceScaleFactor: parseFloat(scale)
    });
    
    const templatePath = path.join(__dirname, 'template.html');
    let htmlTemplate = fs.readFileSync(templatePath, 'utf-8');
    
    const thinkingMatch = markdownText.match(/<thinking>([\s\S]*?)<\/thinking>/i);
    let thinkingContent = '';
    if (thinkingMatch) {
        thinkingContent = thinkingMatch[1].trim();
        markdownText = markdownText.replace(thinkingMatch[0], '');
    }
    
    let htmlContent = await marked.parse(markdownText);
    
    if (thinkingContent) {
        const thinkingHtml = await marked.parse(thinkingContent);
        htmlContent = `<div class="thinking">\n<div class="thinking-label">思考过程</div>\n${thinkingHtml}\n</div>\n${htmlContent}`;
    }
    
    htmlTemplate = htmlTemplate.replace('{{ content }}', htmlContent);
    
    await page.setContent(htmlTemplate, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);
    
    const contentHeight = await page.evaluate(() => {
        const body = document.body;
        const children = Array.from(body.children);
        if (children.length === 0) return 0;
        
        let minTop = Infinity, maxBottom = 0;
        children.forEach(child => {
            const rect = child.getBoundingClientRect();
            if (rect.height > 0) {
                minTop = Math.min(minTop, rect.top);
                maxBottom = Math.max(maxBottom, rect.bottom);
            }
        });
        return Math.max(maxBottom - minTop + 80, body.scrollHeight);
    });
    
    await page.setViewportSize({ 
        width: 900, 
        height: Math.min(Math.max(contentHeight + 50, 200), 10000) 
    });
    
    await page.screenshot({
        path: outputPath,
        type: 'png',
        fullPage: true,
        animations: 'disabled'
    });
    
    await browser.close();
    return outputPath;
}

const args = process.argv.slice(2);
const markdownFile = args[0];
const outputFile = args[1];
const scale = args[2] || '1.0';

if (!markdownFile || !outputFile) {
    console.error('Usage: node render.js <markdown-file> <output-file> [scale]');
    process.exit(1);
}

const markdownText = fs.readFileSync(markdownFile, 'utf-8');
renderMarkdownToImage(markdownText, outputFile, scale)
    .then(() => console.log('Done:', outputFile))
    .catch(err => {
        console.error('Error:', err);
        process.exit(1);
    });
