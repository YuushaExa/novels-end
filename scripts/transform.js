const fs = require('fs-extra');
const path = require('path');
const iconv = require('iconv-lite'); // You'll need to install this package

async function processFiles() {
  try {
    const dataDir = path.join(process.cwd(), 'data');
    const resultDir = path.join(process.cwd(), 'result');
    
    // Create result directory if it doesn't exist
    await fs.ensureDir(resultDir);
    
    // Get all txt files in data directory
    const files = (await fs.readdir(dataDir)).filter(file => file.endsWith('.txt'));
    
    for (const file of files) {
      const filePath = path.join(dataDir, file);
      
      // Read file as buffer and decode with GB18030
      const fileBuffer = await fs.readFile(filePath);
      const content = iconv.decode(fileBuffer, 'gb18030');
      
      // Process content into chapters
      const chapters = [];
      let currentChapter = null;
      
      const lines = content.split('\n');
      for (const line of lines) {
        // Match 第1章, 第2章, etc. (第 followed by numbers followed by 章)
        if (line.match(/^第\d+章/)) {
          if (currentChapter) {
            chapters.push(currentChapter);
          }
          currentChapter = {
            title: line.trim(),
            content: []
          };
        } else if (currentChapter) {
          if (line.trim() || currentChapter.content.length > 0) {
            currentChapter.content.push(line);
          }
        }
      }
      
      // Add the last chapter if it exists
      if (currentChapter) {
        chapters.push(currentChapter);
      }
      
      // Convert content arrays to strings
      chapters.forEach(chapter => {
        chapter.content = chapter.content.join('\n').trim();
      });
      
      // Write JSON file (will be in UTF-8)
      const outputFile = path.join(resultDir, `${path.basename(file, '.txt')}.json`);
      await fs.writeJson(outputFile, { chapters }, { spaces: 2 });
      console.log(`Processed ${file} -> ${path.basename(outputFile)}`);
    }
    
    console.log('All files processed successfully!');
  } catch (error) {
    console.error('Error processing files:', error);
    process.exit(1);
  }
}

processFiles();
