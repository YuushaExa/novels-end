const fs = require('fs-extra');
const path = require('path');
const { gzipSync, gunzipSync } = require('zlib');
const unzipper = require('unzipper');
const iconv = require('iconv-lite');

// 1. Compression Utilities
async function saveCompressedJson(outputPath, data) {
  const jsonStr = JSON.stringify(data);
  const compressed = gzipSync(jsonStr, { level: 9 });
  await fs.writeFile(outputPath, compressed);
  
  const originalSize = Buffer.byteLength(jsonStr, 'utf8');
  const compressedSize = compressed.length;
  const ratio = ((compressedSize / originalSize) * 100).toFixed(1);
  
  console.log([
    `✓ ${path.basename(outputPath)}`,
    `Original: ${(originalSize / 1024).toFixed(2)}KB`,
    `Compressed: ${(compressedSize / 1024).toFixed(2)}KB`,
    `Ratio: ${ratio}%`
  ].join(' | '));
}

async function readCompressedJson(filePath) {
  const compressed = await fs.readFile(filePath);
  return JSON.parse(gunzipSync(compressed).toString('utf8'));
}

// 2. Core Processing Functions
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

// 3. File Handling
async function processZipFiles(dataDir) {
  const zipFiles = (await fs.readdir(dataDir)).filter(f => f.endsWith('.zip'));
  const zipToTxtMap = {}; // New: Map ZIP names to extracted TXT names
  
  for (const zipFile of zipFiles) {
    const zipPath = path.join(dataDir, zipFile);
    console.log(`\nExtracting ${zipFile}...`);

    await fs.createReadStream(zipPath)
      .pipe(unzipper.Parse())
      .on('entry', entry => {
        const fileName = entry.path;
        if (fileName.endsWith('.txt')) {
          zipToTxtMap[fileName] = zipFile.replace('.zip', '');
          entry.pipe(fs.createWriteStream(path.join(dataDir, fileName)));
        } else {
          entry.autodrain();
        }
      })
      .promise();
    console.log(`✓ Extracted ${zipFile}`);
  }
  
  return zipToTxtMap; // Return the mapping
}

// 4. Main Execution
async function main(selectedFiles = []) {
  const dataDir = path.join(process.cwd(), 'data');
  const resultDir = path.join(process.cwd(), 'result');
  
  await fs.ensureDir(dataDir);
  await fs.ensureDir(resultDir);
  
  // Process ZIP files and get the mapping
  const zipToTxtMap = await processZipFiles(dataDir);
  
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
    // Get the base name from the ZIP file name and remove _tw
    const baseName = (zipToTxtMap[file] || path.basename(file, '.txt')).replace(/_tw$/, '');
    await processTextFile(
      path.join(dataDir, file),
      path.join(resultDir, `${baseName}.json.gz`)
    );
  }
  
  console.log('\nProcessing complete!');
}

// Helper Functions
function containsMalformedUTF8(text) {
  return /�/.test(text) || 
    (/[^\x00-\x7F]/.test(text) && !/[一-龯]/.test(text));
}

// Run
main(process.argv.slice(2)).catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
