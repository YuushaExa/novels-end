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
      const content = await fs.readFile(filePath, 'utf8');
      
      // Split content by chapter markers (第X章)
      const chapterSections = content.split(/(第\d+章[^\n]*)/).filter(section => section.trim());
      
      const chapters = [];
      for (let i = 1; i < chapterSections.length; i += 2) {
        const title = chapterSections[i].trim();
        let chapterContent = chapterSections[i+1].trim();
        
        // Remove the === separators if they exist
        chapterContent = chapterContent.replace(/^===+[\s\S]*?===+/gm, '').trim();
        
        chapters.push({
          title,
          content: chapterContent
        });
      }
      
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
