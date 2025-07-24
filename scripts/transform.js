const fs = require('fs-extra');
const path = require('path');
const unzipper = require('unzipper');
const iconv = require('iconv-lite');
const chardet = require('chardet');

// ======================
// CONFIGURATION
// ======================
const CONFIG = {
  inputDir: path.join(__dirname, 'data'),
  outputDir: path.join(__dirname, 'cleaned'),
  tempDir: path.join(__dirname, 'temp'),
  encodingFallback: 'gb18030', // Default fallback for Chinese texts
  maxFileSize: 50 * 1024 * 1024, // 50MB
  cleanTemp: true
};

// ======================
// PUNCTUATION STANDARDIZATION
// ======================
const PUNCTUATION_MAP = {
  // Chinese to English
  '，': ',',    '。': '.',    '；': ';',    '：': ':',    '？': '?',
  '！': '!',    '“': '"',     '”': '"',     '‘': "'",     '’': "'",
  '（': '(',    '）': ')',    '【': '[',    '】': ']',    '、': ',',
  '《': '"',     '》': '"',    '…': '...',   '—': '-',     '～': '~',
  // Whitespace normalization
  '\u00A0': ' ', '\u200B': ' ', '\u3000': ' ', '\uFEFF': '',
  // Common artifacts
  '�': '',     '\uFFFD': '',   '\uFFFF': '',   '﻿': ''
};

// ======================
// CORE FUNCTIONS
// ======================

/**
 * Standardizes all punctuation and cleans text
 */
async function cleanText(content) {
  let cleaned = content
    // Normalize line endings first
    .replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    // Replace all mapped punctuation
    .replace(new RegExp(`[${Object.keys(PUNCTUATION_MAP).join('')}]`, 'g'), 
      match => PUNCTUATION_MAP[match]);

  // Fix common patterns
  cleaned = cleaned
    .replace(/,，/g, ',')
    .replace(/\.\.\.+/g, '...')
    .replace(/\s+([.,!?;:])/g, '$1')
    .replace(/([.,!?;:])([^\s"])/g, '$1 $2')
    .replace(/(["'])\s+(.+?)\s+\1/g, '$1$2$1') // Fix spaced quotes
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return cleaned;
}

/**
 * Detects file encoding and reads content
 */
async function readFileSafely(filePath) {
  const stats = await fs.stat(filePath);
  if (stats.size > CONFIG.maxFileSize) {
    throw new Error(`File too large (${stats.size} bytes > ${CONFIG.maxFileSize} limit)`);
  }

  const buffer = await fs.readFile(filePath);
  const detectedEncoding = chardet.detect(buffer) || 'utf8';
  
  try {
    // Try detected encoding first
    let content = iconv.decode(buffer, detectedEncoding);
    if (containsMalformedText(content)) {
      throw new Error('Malformed text detected');
    }
    return content;
  } catch (e) {
    // Fallback to configured encoding
    return iconv.decode(buffer, CONFIG.encodingFallback);
  }
}

/**
 * Processes a single novel file
 */
async function processNovelFile(filePath) {
  try {
    const content = await readFileSafely(filePath);
    const cleaned = await cleanText(content);
    
    // Extract chapters (customize this for your format)
    const chapters = [];
    const chapterRegex = /^(第[零一二三四五六七八九十百千万\d]+章\s*.+)$/gm;
    let match;
    
    while ((match = chapterRegex.exec(cleaned)) !== null) {
      const title = match[1].trim();
      const startPos = match.index + match[0].length;
      const nextMatch = chapterRegex.exec(cleaned);
      const endPos = nextMatch ? nextMatch.index : cleaned.length;
      
      chapters.push({
        title,
        content: cleaned.slice(startPos, endPos)
          .replace(/^\s*\n/, '')
          .replace(/\s*\n$/, '')
      });
      
      if (nextMatch) chapterRegex.lastIndex = nextMatch.index;
    }

    return {
      metadata: {
        sourceFile: path.basename(filePath),
        encoding: 'UTF-8',
        processedAt: new Date().toISOString(),
        chapterCount: chapters.length
      },
      chapters: chapters.length > 0 ? chapters : [{ title: 'Full Text', content: cleaned }]
    };
  } catch (error) {
    return {
      error: error.message,
      file: path.basename(filePath),
      stack: error.stack
    };
  }
}

/**
 * Extracts and processes ZIP archives
 */
async function processZipArchive(zipPath) {
  const extractDir = path.join(CONFIG.tempDir, path.basename(zipPath, '.zip'));
  await fs.ensureDir(extractDir);

  try {
    console.log(`Extracting ${path.basename(zipPath)}...`);
    await fs.pipeline(
      fs.createReadStream(zipPath),
      unzipper.Extract({ path: extractDir })
    ).promise();

    const extractedFiles = (await fs.readdir(extractDir))
      .filter(f => ['.txt', '.json'].includes(path.extname(f).toLowerCase()));
    
    const results = [];
    for (const file of extractedFiles) {
      const result = await processNovelFile(path.join(extractDir, file));
      results.push(result);
    }
    
    return results;
  } finally {
    if (CONFIG.cleanTemp) {
      await fs.remove(extractDir);
    }
  }
}

// ======================
// UTILITIES
// ======================
function containsMalformedText(text) {
  return /�/.test(text) || 
        (/[^\x00-\x7F]/.test(text) && !/[一-龯]/.test(text));
}

async function ensureDirectories() {
  await Promise.all([
    fs.ensureDir(CONFIG.inputDir),
    fs.ensureDir(CONFIG.outputDir),
    fs.ensureDir(CONFIG.tempDir)
  ]);
}

// ======================
// MAIN EXECUTION
// ======================
async function main() {
  try {
    await ensureDirectories();
    
    // Process ZIP files first
    const zipFiles = (await fs.readdir(CONFIG.inputDir))
      .filter(f => f.endsWith('.zip'));
    
    for (const zipFile of zipFiles) {
      const results = await processZipArchive(path.join(CONFIG.inputDir, zipFile));
      
      for (const result of results) {
        if (result.error) {
          console.error(`Error processing file from ${zipFile}:`, result.error);
          continue;
        }
        
        const outputFile = path.join(
          CONFIG.outputDir,
          `${path.basename(result.metadata.sourceFile, path.extname(result.metadata.sourceFile))}_cleaned.json`
        );
        
        await fs.writeJson(outputFile, result, { spaces: 2 });
        console.log(`Processed ${result.metadata.sourceFile} → ${path.basename(outputFile)}`);
      }
    }
    
    // Process standalone files
    const standaloneFiles = (await fs.readdir(CONFIG.inputDir))
      .filter(f => ['.txt', '.json'].includes(path.extname(f).toLowerCase()))
      .filter(f => !f.endsWith('.zip'));
    
    for (const file of standaloneFiles) {
      const result = await processNovelFile(path.join(CONFIG.inputDir, file));
      
      if (result.error) {
        console.error(`Error processing ${file}:`, result.error);
        continue;
      }
      
      const outputFile = path.join(
        CONFIG.outputDir,
        `${path.basename(file, path.extname(file))}_cleaned.json`
      );
      
      await fs.writeJson(outputFile, result, { spaces: 2 });
      console.log(`Processed ${file} → ${path.basename(outputFile)}`);
    }
    
    console.log('Processing complete!');
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  } finally {
    if (CONFIG.cleanTemp) {
      await fs.remove(CONFIG.tempDir).catch(() => {});
    }
  }
}

// ======================
// INITIALIZATION
// ======================
async function installDependencies() {
  const required = ['unzipper', 'iconv-lite', 'chardet'];
  for (const pkg of required) {
    try {
      require.resolve(pkg);
    } catch {
      console.log(`Installing ${pkg}...`);
      const { execSync } = require('child_process');
      execSync(`npm install ${pkg}`, { stdio: 'inherit' });
    }
  }
}

installDependencies().then(main);
