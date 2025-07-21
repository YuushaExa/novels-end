const fs = require('fs-extra');
const path = require('path');

async function processFiles() {
  try {
    const dataDir = path.join(process.cwd(), 'data');
    const resultDir = path.join(process.cwd(), 'result');
    
    await fs.ensureDir(resultDir);
    const files = (await fs.readdir(dataDir)).filter(file => file.endsWith('.txt'));
    
    for (const file of files) {
      const filePath = path.join(dataDir, file);
      
      // Read file as binary buffer (since Node.js doesn't support GB18030 natively)
      const fileBuffer = await fs.readFile(filePath);
      
      // Manually decode binary buffer (this is a simple approach)
      // Note: This may not handle all GB18030 characters perfectly!
      let content = fileBuffer.toString('binary');
      
      // Process content into chapters
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
    
    console.log('All files processed successfully!');
  } catch (error) {
    console.error('Error processing files:', error);
    process.exit(1);
  }
}

processFiles();
