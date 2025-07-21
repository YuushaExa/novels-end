const fs = require('fs-extra');
const path = require('path');

async function processFiles(selectedFiles = []) {
  try {
    const dataDir = path.join(process.cwd(), 'data');
    const resultDir = path.join(process.cwd(), 'result');
    
    await fs.ensureDir(resultDir);
    let files = (await fs.readdir(dataDir)).filter(file => file.endsWith('.txt'));
    
    // Filter files if specific files are selected
    if (selectedFiles.length > 0) {
      files = files.filter(file => selectedFiles.includes(file));
      if (files.length === 0) {
        console.log('No matching files found in data directory.');
        return;
      }
    }
    
    for (const file of files) {
      const filePath = path.join(dataDir, file);
      
      // Read file as UTF-8 (default)
      let content = await fs.readFile(filePath, 'utf8');
      
      // (Optional) Fallback to binary if UTF-8 fails (for GB18030 files)
      if (containsMalformedUTF8(content)) {
        console.warn(`Falling back to binary decoding for ${file}`);
        const buffer = await fs.readFile(filePath);
        content = buffer.toString('binary'); // Simple fallback (not perfect)
      }
      
      // Process chapters
      const chapters = [];
      let currentChapter = null;
      
      const lines = content.split('\n');
      for (const line of lines) {
        if (line.match(/^第\d+章/)) {
          if (currentChapter) chapters.push(currentChapter);
          currentChapter = { title: line.trim(), content: [] };
        } else if (currentChapter) {
          if (line.trim() || currentChapter.content.length > 0) {
            currentChapter.content.push(line);
          }
        }
      }
      
      if (currentChapter) chapters.push(currentChapter);
      
      chapters.forEach(chapter => {
        chapter.content = chapter.content.join('\n').trim();
      });
      
      const outputFile = path.join(resultDir, `${path.basename(file, '.txt')}.json`);
      await fs.writeJson(outputFile, { chapters }, { spaces: 2 });
      console.log(`Processed ${file} -> ${path.basename(outputFile)}`);
    }
    
    console.log('All selected files processed successfully!');
  } catch (error) {
    console.error('Error processing files:', error);
    process.exit(1);
  }
}

// Helper: Detects if UTF-8 decoding produced malformed characters
function containsMalformedUTF8(text) {
  return /�/.test(text); // Checks for replacement character (�)
}

// Get file names from command line arguments
const selectedFiles = process.argv.slice(2);
processFiles(selectedFiles);
