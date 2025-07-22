const fs = require('fs-extra');
const path = require('path');
const { pipeline } = require('stream/promises');
const unzipper = require('unzipper');
const iconv = require('iconv-lite');
const JSZip = require('jszip');

// Configuration
const CONFIG = {
  INPUT_DIR: path.join(process.cwd(), 'data'),
  OUTPUT_DIR: path.join(process.cwd(), 'result'),
  ZIP_COMPRESSION_LEVEL: 9,
  ENCODINGS: ['utf8', 'gb18030'],
  CHAPTER_REGEX: /^第[零一二三四五六七八九十百千万\d]+章/,
  MAX_CONCURRENT_FILES: 5
};

// 1. Enhanced Compression Utilities
class CompressionManager {
  static async saveAsZip(outputPath, data) {
    const jsonStr = JSON.stringify(data);
    const zip = new JSZip();
    
    // Measure performance
    const startTime = process.hrtime.bigint();
    zip.file('data.json', jsonStr);
    
    const zipContent = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: CONFIG.ZIP_COMPRESSION_LEVEL }
    });
    
    await fs.writeFile(outputPath, zipContent);
    
    // Calculate metrics
    const originalSize = Buffer.byteLength(jsonStr, 'utf8');
    const compressedSize = zipContent.length;
    const ratio = ((compressedSize / originalSize) * 100).toFixed(1);
    const elapsedMs = Number(process.hrtime.bigint() - startTime) / 1e6;
    
    console.log([
      `✓ ${path.basename(outputPath)}`,
      `Size: ${(originalSize / 1024).toFixed(2)}KB → ${(compressedSize / 1024).toFixed(2)}KB`,
      `Ratio: ${ratio}%`,
      `Time: ${elapsedMs.toFixed(2)}ms`
    ].join(' | '));
    
    return { originalSize, compressedSize };
  }

  static async readZip(filePath) {
    const zipData = await fs.readFile(filePath);
    const zip = await JSZip.loadAsync(zipData);
    const jsonContent = await zip.file('data.json').async('text');
    return JSON.parse(jsonContent);
  }
}

// 2. Optimized Text Processing
class TextProcessor {
  static async detectEncoding(buffer) {
    for (const encoding of CONFIG.ENCODINGS) {
      try {
        const decoded = iconv.decode(buffer, encoding);
        if (!this.containsMalformedText(decoded, encoding)) {
          return { encoding, content: decoded };
        }
      } catch (e) {
        continue;
      }
    }
    throw new Error('Failed to detect proper encoding');
  }

  static containsMalformedText(text, encoding) {
    if (encoding === 'utf8') {
      return /�/.test(text) || (/[^\x00-\x7F]/.test(text) && !/[一-龯]/.test(text));
    }
    return false;
  }

  static async extractChapters(content) {
    const chapters = [];
    let currentChapter = null;
    const lines = content.split('\n');

    for (const line of lines) {
      if (CONFIG.CHAPTER_REGEX.test(line)) {
        if (currentChapter) {
          currentChapter.content = this.cleanContent(currentChapter.content.join('\n'));
          chapters.push(currentChapter);
        }
        currentChapter = { 
          title: line.trim(),
          content: []
        };
      } else if (currentChapter) {
        currentChapter.content.push(line);
      }
    }

    if (currentChapter) {
      currentChapter.content = this.cleanContent(currentChapter.content.join('\n'));
      chapters.push(currentChapter);
    }

    return chapters;
  }

  static cleanContent(content) {
    return content
      .replace(/^\s+|\s+$/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/\s{2,}/g, ' ');
  }
}

// 3. Optimized File Operations
class FileManager {
  static async processZipFiles() {
    const zipFiles = (await fs.readdir(CONFIG.INPUT_DIR))
      .filter(f => f.endsWith('.zip'));
    
    await Promise.all(zipFiles.map(async zipFile => {
      const zipPath = path.join(CONFIG.INPUT_DIR, zipFile);
      console.log(`Extracting ${zipFile}...`);
      
      try {
        await pipeline(
          fs.createReadStream(zipPath),
          unzipper.Extract({ path: CONFIG.INPUT_DIR })
        );
        console.log(`✓ Successfully extracted ${zipFile}`);
      } catch (error) {
        console.error(`✗ Failed to extract ${zipFile}:`, error.message);
      }
    }));
  }

  static async processTextFile(file) {
    const inputPath = path.join(CONFIG.INPUT_DIR, file);
    const outputPath = path.join(CONFIG.OUTPUT_DIR, `${path.basename(file, '.txt')}.zip`);
    
    try {
      const buffer = await fs.readFile(inputPath);
      const { content } = await TextProcessor.detectEncoding(buffer);
      const chapters = await TextProcessor.extractChapters(content);
      
      if (chapters.length === 0) {
        console.warn(`⚠ No chapters found in ${file}`);
        return;
      }
      
      await CompressionManager.saveAsZip(outputPath, { chapters });
    } catch (error) {
      console.error(`✗ Error processing ${file}:`, error.message);
    }
  }

  static async processAllTextFiles(selectedFiles = []) {
    let textFiles = (await fs.readdir(CONFIG.INPUT_DIR))
      .filter(f => f.endsWith('.txt'));
    
    if (selectedFiles.length > 0) {
      const normalized = selectedFiles.map(f => 
        f.endsWith('.txt') ? f : `${f}.txt`
      );
      textFiles = textFiles.filter(f => normalized.includes(f));
    }
    
    // Process files in batches to avoid memory issues
    for (let i = 0; i < textFiles.length; i += CONFIG.MAX_CONCURRENT_FILES) {
      const batch = textFiles.slice(i, i + CONFIG.MAX_CONCURRENT_FILES);
      await Promise.all(batch.map(file => this.processTextFile(file)));
    }
  }
}

// 4. Main Execution
async function main(selectedFiles = []) {
  try {
    console.time('Total processing time');
    
    await fs.ensureDir(CONFIG.INPUT_DIR);
    await fs.ensureDir(CONFIG.OUTPUT_DIR);
    
    console.log('Starting ZIP file extraction...');
    await FileManager.processZipFiles();
    
    console.log('\nStarting text file processing:');
    await FileManager.processAllTextFiles(selectedFiles);
    
    console.timeEnd('Total processing time');
    console.log('\nProcessing complete!');
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

// Run
main(process.argv.slice(2));
