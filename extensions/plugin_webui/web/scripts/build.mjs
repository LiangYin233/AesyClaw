import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';

const webRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const requireFromWeb = createRequire(import.meta.url);

function packageBin(packageName, relativeBinPath) {
  const packageJsonPath = requireFromWeb.resolve(`${packageName}/package.json`);
  return join(dirname(packageJsonPath), relativeBinPath);
}

function runNodeScript(scriptPath, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd: webRoot,
      stdio: 'inherit',
      env: process.env,
      windowsHide: true,
    });

    child.on('error', reject);
    child.on('close', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${scriptPath} failed with ${signal ?? `exit code ${code ?? 'unknown'}`}`));
    });
  });
}

await runNodeScript(packageBin('vue-tsc', 'bin/vue-tsc.js'), ['--noEmit']);
await runNodeScript(packageBin('vite', 'bin/vite.js'), ['build']);
