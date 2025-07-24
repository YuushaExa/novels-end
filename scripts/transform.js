const fs = require('fs-extra');
const path = require('path');
const iconv = require('iconv-lite');

// Enhanced punctuation standardization mapping
const PUNCTUATION_MAP = {
  // Chinese to English punctuation
  '，': ',',    // Chinese comma
  '。': '.',    // Chinese period
  '；': ';',    // Chinese semicolon
  '：': ':',    // Chinese colon
  '？': '?',    // Chinese question mark
  '！': '!',    // Chinese exclamation
  '“': '"',     // Chinese left double quote
  '”': '"',     // Chinese right double quote
  '‘': "'",     // Chinese left single quote
  '’': "'",     // Chinese right single quote
  '（': '(',    // Chinese left parenthesis
  '）': ')',    // Chinese right parenthesis
  '【': '[',    // Chinese left square bracket
  '】': ']',    // Chinese right square bracket
  '、': ',',    // Chinese enumeration comma
  '《': '"',     // Chinese left title mark
  '》': '"',     // Chinese right title mark
  '…': '...',   // Chinese ellipsis
  // Normalize different space characters
  '\u00A0': ' ',  // Non-breaking space
  '\u3000': ' ',  // Ideographic space
  // Fix common encoding artifacts
  '�': '',       // Remove replacement characters
  '\uFEFF': ''   // Remove BOM
};

async function cleanAndStandardize(content) {
  // Step 1: Normalize line endings
  let cleaned = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  
  // Step 2: Replace all Chinese punctuation with English equivalents
  Object.keys(PUNCTUATION_MAP).forEach(chineseChar => {
    const regex = new RegExp(chineseChar, 'g');
    cleaned = cleaned.replace(regex, PUNCTUATION_MAP[chineseChar]);
  });
  
  // Step 3: Standardize quotes
  cleaned = cleaned.replace(/[＂‟ˮ]/g, '"')  // Various double quotes
                  .replace(/[＇ʹʻʼ]/g, "'"); // Various single quotes
  
  // Step 4: Fix common malformed patterns
  cleaned = cleaned.replace(/,，/g, ',')     // Mixed commas
                  .replace(/\.\.\.+/g, '...') // Multiple ellipses
                  .replace(/\s+([.,!?;:])/g, '$1') // Spaces before punctuation
                  .replace(/([.,!?;:])([^\s])/g, '$1 $2'); // Add space after punctuation
  
  // Step 5: Clean paragraph spacing
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n') // Max 2 newlines
                  .trim();
  
  return cleaned;
}

async function processFileSet(files, dataDir, resultDir) {
  for (const file of files) {
    const filePath = path.join(dataDir, file);
    const outputFile = path.join(resultDir, `${path.basename(file, path.extname(file))}_cleaned.json`);
    
    try {
      // Read with proper encoding handling
      let content;
      try {
        content = await fs.readFile(filePath, 'utf8');
        if (containsMalformedUTF8(content)) {
          throw new Error('Malformed UTF-8 detected');
        }
      } catch (e) {
        const buffer = await fs.readFile(filePath);
        content = iconv.decode(buffer, 'gb18030');
      }

      // Clean content before JSON processing
      content = await cleanAndStandardize(content);
      
      // Parse chapters (adjust this to match your actual structure)
      const chapters = [];
      const chapterRegex = /^(第[零一二三四五六七八九十百千万\d]+章\s*.+)$/gm;
      let match;
      
      while ((match = chapterRegex.exec(content)) !== null) {
        const chapterTitle = match[1].trim();
        const chapterStart = match.index + match[0].length;
        const nextMatch = chapterRegex.exec(content);
        const chapterEnd = nextMatch ? nextMatch.index : content.length;
        
        chapters.push({
          title: chapterTitle,
          content: content.slice(chapterStart, chapterEnd).trim()
        });
        
        chapterRegex.lastIndex = chapterEnd;
      }
      
      // Additional cleaning for each chapter
      chapters.forEach(chapter => {
        chapter.content = chapter.content
          .replace(/^\s*\n/, '')
          .replace(/\s*\n$/, '')
          .replace(/\n{3,}/g, '\n\n');
      });
      
      // Write cleaned JSON
      await fs.writeJson(outputFile, { 
        metadata: {
          originalFile: file,
          processedAt: new Date().toISOString(),
          encoding: 'UTF-8'
        },
        chapters 
      }, { spaces: 2 });
      
      console.log(`Successfully processed ${file} → ${path.basename(outputFile)}`);
      
    } catch (error) {
      console.error(`Error processing ${file}:`, error.message);
    }
  }
}

// Helper function to detect encoding issues
function containsMalformedUTF8(text) {
  return /�/.test(text) || 
         (/[^\x00-\x7F]/.test(text) && !/[一-龯]/.test(text));
}

// Main execution
async function main() {
  await checkDependencies();
  const dataDir = path.join(__dirname, 'data');
  const resultDir = path.join(__dirname, 'result');
  
  await fs.ensureDir(dataDir);
  await fs.ensureDir(resultDir);
  
  const files = (await fs.readdir(dataDir))
    .filter(file => ['.txt', '.json'].includes(path.extname(file).toLowerCase()));
  
  if (files.length === 0) {
    console.log('No files found in data directory');
    return;
  }
  
  await processFileSet(files, dataDir, resultDir);
}

main().catch(console.error);
