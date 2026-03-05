import { resolve } from 'path';
import { existsSync, mkdirSync } from 'fs';

const PYTHON_BOOTSTRAP = [
  "import sys",
  "import io",
  "sys.stdout.reconfigure(encoding='utf-8', errors='replace')",
  "sys.stderr.reconfigure(encoding='utf-8', errors='replace')",
  "import os",
  "os.makedirs('/sandbox', exist_ok=True)",
  "os.environ.setdefault('MPLBACKEND', 'Agg')"
].join('\n');

const PYTHON_PRELUDE = [
  "import matplotlib",
  "matplotlib.use('Agg')"
].join('\n');

export class PyodideRunner {
  constructor(options, logger) {
    this.options = options;
    this.log = logger;
    this.pyodideInstance = null;
    this.pyodideLoading = null;
    this.pyodideMounted = false;
    this.packagesLoaded = false;
    this.sandboxDir = options.sandboxDir || '/sandbox';
    this.mountDir = options.mountDir;
  }

  async load() {
    if (this.pyodideInstance) {
      return this.pyodideInstance;
    }

    if (this.pyodideLoading) {
      return this.pyodideLoading;
    }

    this.pyodideLoading = (async () => {
      try {
        const { loadPyodide } = await import('./node_modules/pyodide/pyodide.mjs');
        const pyodide = await loadPyodide({
          indexURL: resolve(this.options.pyodideDir, './node_modules/pyodide')
        });

        if (!this.pyodideMounted && this.mountDir) {
          if (!existsSync(this.mountDir)) {
            mkdirSync(this.mountDir, { recursive: true });
          }
          pyodide.mountNodeFS(this.sandboxDir, this.mountDir);
          this.pyodideMounted = true;
          this.log.info(`Pyodide sandbox mounted at ${this.sandboxDir} -> ${this.mountDir}`);
        }

        this.pyodideInstance = pyodide;
        this.log.info('Pyodide loaded successfully');
        return pyodide;
      } catch (error) {
        this.log.error('Failed to load Pyodide:', error.message);
        this.pyodideLoading = null;
        throw error;
      }
    })();

    return this.pyodideLoading;
  }

  async loadPackages(packages) {
    const pyodide = await this.load();

    if (this.packagesLoaded) {
      return;
    }

    try {
      await pyodide.loadPackage('micropip');
      const micropip = pyodide.pyimport('micropip');

      for (const pkg of packages) {
        try {
          await micropip.install(pkg);
          this.log.info(`Loaded Python package: ${pkg}`);
        } catch (e) {
          this.log.warn(`Failed to load package ${pkg}: ${e.message}`);
        }
      }

      this.packagesLoaded = true;
    } catch (error) {
      this.log.error('Failed to load default packages:', error.message);
      throw error;
    }
  }

  prepareCode(code) {
    return `${PYTHON_BOOTSTRAP}\n${PYTHON_PRELUDE}\n${code}`;
  }

  truncateOutput(output) {
    if (!output) return '';
    const maxOutput = this.options.maxOutput || 10000;
    if (output.length <= maxOutput) return output;
    return output.substring(0, maxOutput) + `\n[输出已截断，原始长度: ${output.length} 字符]`;
  }

  async execute(code) {
    if (typeof code !== 'string') {
      return 'Python 执行错误: code 参数必须是字符串';
    }

    const pyodide = await this.load();
    await this.loadPackages(this.options.packages || []);

    try {
      const codeToRun = this.prepareCode(code);
      const result = await pyodide.runPythonAsync(codeToRun);
      this.log.debug('Executed python successfully');

      const strResult = result === undefined || result === null
        ? '代码执行完成（无返回值）'
        : String(result);

      return this.truncateOutput(strResult);
    } catch (error) {
      this.log.error('Python execution failed:', error.message);
      return `Python 执行错误: ${error.message}`;
    }
  }

  async dispose() {
    this.pyodideInstance = null;
    this.pyodideLoading = null;
    this.packagesLoaded = false;
  }
}

export default PyodideRunner;
