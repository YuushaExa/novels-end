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
      let content = await fs.readFile(filePath, 'utf8');
      
      const chapters = [];
      let currentChapter = null;
      let inContent = false;
      
      const lines = content.split('\n');
      for (const line of lines) {
        const trimmedLine = line.trim().replace(/[\u3000]/g, ' ');
        
        // Skip until we find the content marker
        if (!inContent) {
          if (trimmedLine.includes('------章節內容開始-------')) {
            inContent = true;
          }
          continue;
        }
        
        // Match chapter titles (第X章 followed by optional space and title text)
        if (trimmedLine.match(/^第\d+章\s*.+/)) {
          if (currentChapter) {
            chapters.push(currentChapter);
          }
          currentChapter = {
            title: trimmedLine,
            content: []
          };
        } else if (currentChapter) {
          if (trimmedLine || currentChapter.content.length > 0) {
            currentChapter.content.push(trimmedLine);
          }
        }
      }
      
      if (currentChapter) {
        chapters.push(currentChapter);
      }
      
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
