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
      
      // Normalize line endings and remove special spaces
      content = content.replace(/\r\n/g, '\n')
                       .replace(/[\u3000]/g, ' ');
      
      const chapters = [];
      let currentChapter = null;
      let inContent = false;
      
      const lines = content.split('\n');
      for (const line of lines) {
        const trimmedLine = line.trim();
        
        // Skip metadata and find content start marker
        if (!inContent) {
          if (trimmedLine.includes('------章節內容開始-------')) {
            inContent = true;
          }
          continue;
        }
        
        // Enhanced chapter detection
        const chapterMatch = trimmedLine.match(/^(第\d+章)(?:\s*(.+))?/);
        if (chapterMatch) {
          if (currentChapter) {
            chapters.push(currentChapter);
          }
          currentChapter = {
            title: chapterMatch[1] + (chapterMatch[2] ? ' ' + chapterMatch[2] : ''),
            content: []
          };
        } else if (currentChapter) {
          // Only add content if we're in a chapter
          if (trimmedLine || currentChapter.content.length > 0) {
            currentChapter.content.push(trimmedLine);
          }
        }
      }
      
      // Add the last chapter if exists
      if (currentChapter) {
        chapters.push(currentChapter);
      }
      
      // Clean up chapter contents
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
