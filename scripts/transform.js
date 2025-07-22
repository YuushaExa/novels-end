const fs = require('fs-extra');
const path = require('path');
const unzipper = require('unzipper');
const iconv = require('iconv-lite');
const { promisify } = require('util');
const JSZip = require('jszip');

// 1. Compression Utilities (updated to use ZIP instead of GZIP)
async function saveCompressedJson(outputPath, data) {
  const jsonStr = JSON.stringify(data);
  const zip = new JSZip();
  zip.file('data.json', jsonStr);
  
  const zipContent = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 }
  });
  
  await fs.writeFile(outputPath, zipContent);
  
  const originalSize = Buffer.byteLength(jsonStr, 'utf8');
  const compressedSize = zipContent.length;
  const ratio = ((compressedSize / originalSize) * 100).toFixed(1);
  
  console.log([
    `✓ ${path.basename(outputPath)}`,
    `Original: ${(originalSize / 1024).toFixed(2)}KB`,
    `Compressed: ${(compressedSize / 1024).toFixed(2)}KB`,
    `Ratio: ${ratio}%`
  ].join(' | '));
}

async function readCompressedJson(filePath) {
  const zipData = await fs.readFile(filePath);
  const zip = await JSZip.loadAsync(zipData);
  const jsonContent = await zip.file('data.json').async('text');
  return JSON.parse(jsonContent);
}

// 2. Core Processing Functions (unchanged)
async function extractChapters(content) {
  const chapters = [];
  let currentChapter = null;
  
  const lines = content.split('\n');
  for (const line of lines) {
    if (line.match(/^第[零一二三四五六七八九十百千万\d]+章/)) {
      if (currentChapter) chapters.push(currentChapter);
      currentChapter = { 
        title: line.trim(),
        content: []
      };
    } else if (currentChapter) {
      currentChapter.content.push(line);
    }
  }
  
  if (currentChapter) chapters.push(currentChapter);
  
  // Clean content
  return chapters.map(ch => ({
    title: ch.title,
    content: ch.content.join('\n')
      .replace(/^\s+|\s+$/g, '')
      .replace(/\n{3,}/g, '\n\n')
  }));
}

async function processTextFile(filePath, outputPath) {
  try {
    // Read with proper encoding
    let content;
    try {
      content = await fs.readFile(filePath, 'utf8');
      if (containsMalformedUTF8(content)) {
        throw new Error('UTF-8 decode failed');
      }
    } catch {
      const buffer = await fs.readFile(filePath);
      content = iconv.decode(buffer, 'gb18030');
    }

    const chapters = await extractChapters(content);
    if (chapters.length > 0) {
      await saveCompressedJson(outputPath, { chapters });
    } else {
      console.warn(`⚠ No chapters found in ${path.basename(filePath)}`);
    }
  } catch (error) {
    console.error(`✗ Error processing ${path.basename(filePath)}:`, error.message);
  }
}

// 3. File Handling (unchanged)
async function processZipFiles(dataDir) {
  const zipFiles = (await fs.readdir(dataDir)).filter(f => f.endsWith('.zip'));
  
  for (const zipFile of zipFiles) {
    const zipPath = path.join(dataDir, zipFile);
    console.log(`\nExtracting ${zipFile}...`);

    await fs.createReadStream(zipPath)
      .pipe(unzipper.Extract({ path: dataDir }))
      .promise();
    console.log(`✓ Extracted ${zipFile}`);
  }
}

// 4. Main Execution (unchanged)
async function main(selectedFiles = []) {
  const dataDir = path.join(process.cwd(), 'data');
  const resultDir = path.join(process.cwd(), 'result');
  
  await fs.ensureDir(dataDir);
  await fs.ensureDir(resultDir);
  
  // Process ZIP files first
  await processZipFiles(dataDir);
  
  // Get all text files
  let textFiles = (await fs.readdir(dataDir))
    .filter(f => f.endsWith('.txt'));
  
  // Filter if specific files requested
  if (selectedFiles.length > 0) {
    const normalized = selectedFiles.map(f => 
      f.endsWith('.txt') ? f : `${f}.txt`
    );
    textFiles = textFiles.filter(f => normalized.includes(f));
  }
  
  // Process each file
  console.log('\nStarting compression:');
  for (const file of textFiles) {
    await processTextFile(
      path.join(dataDir, file),
      path.join(resultDir, `${path.basename(file, '.txt')}.zip`)
    );
  }
  
  console.log('\nProcessing complete!');
}

// Helper Functions (unchanged)
function containsMalformedUTF8(text) {
  return /�/.test(text) || 
    (/[^\x00-\x7F]/.test(text) && !/[一-龯]/.test(text));
}

// Run
main(process.argv.slice(2)).catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
